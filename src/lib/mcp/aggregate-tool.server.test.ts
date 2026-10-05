import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateHealthData } from "./aggregate-tool.server";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";

const { FakeGoogleHealthApiError, createGoogleHealthClient } = vi.hoisted(
	() => {
		class HoistedGoogleHealthApiError extends Error {
			readonly status: number;
			readonly googleStatus: string | undefined;
			readonly retryable: boolean;

			constructor(status: number, message: string, googleStatus?: string) {
				super(message);
				this.name = "GoogleHealthApiError";
				this.status = status;
				this.googleStatus = googleStatus;
				this.retryable = status === 429 || status >= 500;
			}
		}
		return {
			FakeGoogleHealthApiError: HoistedGoogleHealthApiError,
			createGoogleHealthClient: vi.fn(),
		};
	},
);

vi.mock("../env.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../env.server")>();
	return {
		...actual,
		getAuthBaseUrl: () => "https://connector.example",
	};
});
vi.mock("../google-health-api.server", () => ({
	createGoogleHealthClient,
	GoogleHealthApiError: FakeGoogleHealthApiError,
}));
vi.mock("../google-health-token.server", () => ({
	GoogleHealthAuthorizationError: class extends Error {},
}));

const NOW = "2026-09-21T12:00:00Z";
const IDENTITY = {
	authenticated: true as const,
	keyId: "key-1",
	userId: "user-1",
};

type ToolResult = Awaited<ReturnType<typeof aggregateHealthData>>;

function payloadOf(result: ToolResult) {
	expect(result.isError).toBe(false);
	return JSON.parse(result.content[0]?.text ?? "") as Record<string, unknown>;
}

function errorOf(result: ToolResult): string {
	expect(result.isError).toBe(true);
	return result.content[0]?.text ?? "";
}

function googleClient(overrides: Record<string, unknown> = {}) {
	const client = {
		collectDataPoints: vi.fn(async () => [] as unknown[]),
		grantedScopes: vi.fn(async () => [] as string[]),
		rollUpDataPoints: vi.fn(async () => [] as unknown[]),
		...overrides,
	};
	createGoogleHealthClient.mockReturnValue(client);
	return client;
}

describe("aggregate_health_data", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
		createGoogleHealthClient.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("before any data is read", () => {
		it("refuses an OAuth token without the health scope", async () => {
			const result = await aggregateHealthData(
				{
					authenticated: true,
					clientId: "client-1",
					scopes: ["openid"],
					userId: "user-1",
					via: "oauth",
				},
				{ dataType: "steps", granularity: "day" },
			);
			expect(errorOf(result)).toContain(MCP_OAUTH_SCOPE);
			expect(createGoogleHealthClient).not.toHaveBeenCalled();
		});

		it("names the catalog tool for an unknown data type", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "mood",
				granularity: "day",
			});
			expect(errorOf(result)).toContain("list_health_data_types");
		});

		it("rejects a date it cannot read", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "last tuesday",
				granularity: "day",
			});
			expect(errorOf(result)).toContain("`from` is not a date");
		});

		it("rejects a range that ends before it starts", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "2026-09-20T00:00:00Z",
				granularity: "day",
				to: "2026-09-19T00:00:00Z",
			});
			expect(errorOf(result)).toContain("`from` must be earlier");
		});

		it("refuses an hourly breakdown of a daily summary", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "daily-resting-heart-rate",
				granularity: "hour",
			});
			expect(errorOf(result)).toContain("Use `day` granularity");
		});

		it("refuses a window with more buckets than one call returns", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "2026-08-01T00:00:00Z",
				granularity: "hour",
				to: "2026-09-01T00:00:00Z",
			});
			const message = errorOf(result);
			expect(message).toContain("744 hour buckets");
			expect(message).toContain("or use `day` granularity");
		});

		it("does not suggest a coarser granularity when already at the coarsest", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "2026-09-01T00:00:00Z",
				granularity: "day",
				to: "2028-09-01T00:00:00Z",
			});
			const message = errorOf(result);
			expect(message).toContain("day buckets");
			expect(message).not.toContain("or use");
		});

		it("refuses a window wholly older than the history limit", async () => {
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "2025-01-01T00:00:00Z",
				granularity: "day",
				to: "2025-01-08T00:00:00Z",
			});
			expect(errorOf(result)).toContain("entirely older");
		});
	});

	describe("from Google's rollup", () => {
		it("asks Google for whole days on the caller's clock", async () => {
			const client = googleClient({
				rollUpDataPoints: vi.fn(async () => [
					{
						endTime: "2026-09-19T16:00:00Z",
						startTime: "2026-09-18T16:00:00Z",
						steps: { countSum: "8123" },
					},
					{
						endTime: "2026-09-20T16:00:00Z",
						startTime: "2026-09-19T16:00:00Z",
					},
				]),
			});

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "steps",
					from: "2026-09-19T09:30:00+08:00",
					granularity: "day",
					to: "2026-09-20T18:00:00+08:00",
					utcOffsetMinutes: 480,
				}),
			);

			expect(client.rollUpDataPoints).toHaveBeenCalledExactlyOnceWith("steps", {
				from: new Date("2026-09-19T00:00:00+08:00"),
				to: new Date("2026-09-21T00:00:00+08:00"),
				windowMs: 24 * 60 * 60 * 1000,
			});
			expect(payload).toMatchObject({
				bucketCount: 1,
				buckets: [
					{
						end: "2026-09-20T00:00:00+08:00",
						start: "2026-09-19T00:00:00+08:00",
						values: { countSum: "8123" },
					},
				],
				dataType: "steps",
				from: "2026-09-19T00:00:00+08:00",
				granularity: "day",
				method: "google-rollup",
				source: "live",
				to: "2026-09-21T00:00:00+08:00",
				utcOffsetMinutes: 480,
			});
		});

		it("defaults to the last week of days, ending the request at now", async () => {
			const client = googleClient();
			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "steps",
					granularity: "day",
				}),
			);

			expect(payload.from).toBe("2026-09-14T00:00:00Z");
			expect(payload.to).toBe("2026-09-22T00:00:00Z");
			// Today's bucket is whole on paper, but Google is never asked about
			// the part of it that has not happened.
			expect(client.rollUpDataPoints).toHaveBeenCalledWith(
				"steps",
				expect.objectContaining({ to: new Date(NOW) }),
			);
		});

		it("defaults to the last day of hours", async () => {
			googleClient();
			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "heart-rate",
					granularity: "hour",
				}),
			);
			expect(payload.from).toBe("2026-09-20T12:00:00Z");
			expect(payload.to).toBe("2026-09-21T12:00:00Z");
		});

		it("splits a range past Google's limit and returns buckets in order", async () => {
			const rollUpDataPoints = vi.fn(
				async (_id: string, options: { from: Date; to: Date }) => [
					{
						endTime: options.to.toISOString(),
						heartRate: { beatsPerMinuteAvg: 61 },
						startTime: options.from.toISOString(),
					},
				],
			);
			googleClient({ rollUpDataPoints });

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "heart-rate",
					from: "2026-08-01T00:00:00Z",
					granularity: "day",
					to: "2026-09-01T00:00:00Z",
				}),
			);

			expect(
				rollUpDataPoints.mock.calls.map(([, options]) => options.from),
			).toEqual([
				new Date("2026-08-01T00:00:00Z"),
				new Date("2026-08-15T00:00:00Z"),
				new Date("2026-08-29T00:00:00Z"),
			]);
			expect(
				(payload.buckets as { start: string }[]).map((bucket) => bucket.start),
			).toEqual([
				"2026-08-01T00:00:00Z",
				"2026-08-15T00:00:00Z",
				"2026-08-29T00:00:00Z",
			]);
		});

		it("serves a rollup-only type", async () => {
			const client = googleClient();

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "total-calories",
					from: "2026-09-01T00:00:00Z",
					granularity: "day",
					to: "2026-09-08T00:00:00Z",
				}),
			);

			expect(payload.method).toBe("google-rollup");
			expect(client.rollUpDataPoints).toHaveBeenCalledOnce();
		});

		it("moves a start past the live history limit forward, and says so", async () => {
			const client = googleClient();
			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "steps",
					from: "2026-01-01T00:00:00Z",
					granularity: "day",
					to: "2026-09-01T00:00:00Z",
				}),
			);

			// Ninety days before now is 12:00 on 23 June; the first whole day after
			// that is the 24th.
			expect(payload.from).toBe("2026-06-24T00:00:00Z");
			expect(payload.historyClamped).toContain("90-day");
			expect(client.rollUpDataPoints).toHaveBeenCalledWith(
				"steps",
				expect.objectContaining({ from: new Date("2026-06-24T00:00:00Z") }),
			);
		});

		it("explains a refused category the way a raw read does", async () => {
			googleClient({
				rollUpDataPoints: vi.fn(async () => {
					throw new FakeGoogleHealthApiError(403, "nope", "PERMISSION_DENIED");
				}),
			});
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				granularity: "day",
			});
			expect(errorOf(result)).toContain("Reconnect Google Health");
		});
	});

	describe("computed from live points", () => {
		it("aggregates a type Google cannot roll up, counting sleep on its wake day", async () => {
			const client = googleClient({
				collectDataPoints: vi.fn(async () => [
					{
						dataSource: { platform: "FITBIT" },
						sleep: {
							interval: {
								endTime: "2026-09-19T06:30:00Z",
								startTime: "2026-09-18T22:30:00Z",
							},
							stages: [{ type: "DEEP" }],
							summary: { minutesAsleep: "440" },
						},
					},
					{
						sleep: {
							interval: {
								endTime: "2026-09-20T07:00:00Z",
								startTime: "2026-09-19T23:00:00Z",
							},
							summary: { minutesAsleep: "455" },
						},
					},
					// Neither a payload nor a time: skipped, not fatal.
					{ dataSource: { platform: "FITBIT" } },
					{ sleep: { summary: { minutesAsleep: "1" } } },
				]),
			});

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "sleep",
					from: "2026-09-19T00:00:00Z",
					granularity: "day",
					to: "2026-09-21T00:00:00Z",
				}),
			);

			expect(client.collectDataPoints).toHaveBeenCalledWith("sleep", {
				from: new Date("2026-09-19T00:00:00Z"),
				limit: 5001,
				to: new Date("2026-09-21T00:00:00Z"),
			});
			expect(payload).toMatchObject({
				bucketCount: 2,
				dataSources: 2,
				method: "computed",
				pointsInWindow: 2,
				source: "live",
			});
			expect(payload.buckets).toEqual([
				{
					end: "2026-09-20T00:00:00Z",
					points: 1,
					start: "2026-09-19T00:00:00Z",
					values: {
						"summary.minutesAsleep": { avg: 440, max: 440, min: 440, sum: 440 },
					},
				},
				{
					end: "2026-09-21T00:00:00Z",
					points: 1,
					start: "2026-09-20T00:00:00Z",
					values: {
						"summary.minutesAsleep": { avg: 455, max: 455, min: 455, sum: 455 },
					},
				},
			]);
		});

		it("keeps a daily summary on its own calendar date whatever the offset", async () => {
			googleClient({
				collectDataPoints: vi.fn(async () => [
					{
						dailyRestingHeartRate: {
							beatsPerMinute: "52",
							date: { day: 19, month: 9, year: 2026 },
						},
					},
				]),
			});

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "daily-resting-heart-rate",
					from: "2026-09-19T00:00:00Z",
					granularity: "day",
					to: "2026-09-20T00:00:00Z",
					utcOffsetMinutes: -300,
				}),
			);

			expect(payload.utcOffsetMinutes).toBe(0);
			expect(payload.buckets).toEqual([
				expect.objectContaining({ start: "2026-09-19T00:00:00Z" }),
			]);
		});

		it("refuses rather than aggregate part of a window", async () => {
			googleClient({
				collectDataPoints: vi.fn(async () =>
					Array.from({ length: 5001 }, () => ({})),
				),
			});
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "sleep",
				granularity: "day",
			});
			expect(errorOf(result)).toContain("more than 5000 raw points");
		});

		it("reports a failed read", async () => {
			googleClient({
				collectDataPoints: vi.fn(async () => {
					throw new Error("socket hang up");
				}),
			});
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "sleep",
				granularity: "day",
			});
			expect(errorOf(result)).toContain("socket hang up");
		});
	});
});
