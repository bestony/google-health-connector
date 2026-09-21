import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateHealthData } from "./aggregate-tool.server";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";

const {
	FakeGoogleHealthApiError,
	createGoogleHealthClient,
	getHealthSyncBackfillDays,
	isHealthSyncEnabled,
	readHealthDataPoints,
	readHealthSyncAccount,
	readHealthSyncStates,
} = vi.hoisted(() => {
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
		getHealthSyncBackfillDays: vi.fn(() => 730),
		isHealthSyncEnabled: vi.fn(() => false),
		readHealthDataPoints: vi.fn(async () => [] as unknown[]),
		readHealthSyncAccount: vi.fn(async () => undefined),
		readHealthSyncStates: vi.fn(async () => []),
	};
});

vi.mock("../env.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../env.server")>();
	return {
		...actual,
		getAuthBaseUrl: () => "https://connector.example",
		getHealthSyncBackfillDays,
		isHealthSyncEnabled,
	};
});
vi.mock("../../db/health-cache.server", () => ({ readHealthDataPoints }));
vi.mock("../../db/health-sync-state.server", () => ({
	readHealthSyncAccount,
	readHealthSyncStates,
}));
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

/** Opted in to stored history, with `dataType` covered for years. */
function storedHistoryCovers(dataType: string) {
	isHealthSyncEnabled.mockReturnValue(true);
	readHealthSyncAccount.mockResolvedValue({ enabled: true } as never);
	readHealthSyncStates.mockResolvedValue([
		{
			coveredFromMs: Date.parse("2024-01-01T00:00:00Z"),
			coveredThroughMs: Date.parse("2026-09-19T00:00:00Z"),
			dataType,
		},
	] as never);
}

describe("aggregate_health_data", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
		createGoogleHealthClient.mockReset();
		isHealthSyncEnabled.mockReturnValue(false);
		getHealthSyncBackfillDays.mockReturnValue(730);
		readHealthDataPoints.mockReset();
		readHealthDataPoints.mockResolvedValue([]);
		readHealthSyncAccount.mockReset();
		readHealthSyncAccount.mockResolvedValue(undefined);
		readHealthSyncStates.mockReset();
		readHealthSyncStates.mockResolvedValue([]);
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
			storedHistoryCovers("steps");
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "steps",
				from: "2024-06-01T00:00:00Z",
				granularity: "day",
				to: "2026-06-01T00:00:00Z",
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

		it("serves a rollup-only type without consulting stored history", async () => {
			storedHistoryCovers("total-calories");
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
			expect(readHealthSyncAccount).not.toHaveBeenCalled();
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

	describe("computed from stored history", () => {
		const WINDOW = {
			from: "2025-01-01T00:00:00Z",
			to: "2025-01-03T00:00:00Z",
		};

		it("aggregates a covered window without calling Google, years back", async () => {
			storedHistoryCovers("steps");
			readHealthDataPoints.mockResolvedValue([
				{
					observedAtMs: Date.parse("2025-01-01T08:00:00Z"),
					observedEndMs: Date.parse("2025-01-01T08:15:00Z"),
					sourceKey: "watch",
					value: { count: "1200" },
				},
				{
					observedAtMs: Date.parse("2025-01-01T08:05:00Z"),
					observedEndMs: Date.parse("2025-01-01T08:20:00Z"),
					sourceKey: "phone",
					value: { count: "1100" },
				},
				{
					observedAtMs: Date.parse("2025-01-01T08:30:00Z"),
					observedEndMs: Date.parse("2025-01-01T08:45:00Z"),
					sourceKey: "watch",
					value: { count: "300" },
				},
			]);

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "steps",
					granularity: "day",
					...WINDOW,
				}),
			);

			expect(createGoogleHealthClient).not.toHaveBeenCalled();
			expect(readHealthDataPoints).toHaveBeenCalledWith({
				anchor: "start",
				dataType: "steps",
				fromMs: Date.parse(WINDOW.from),
				limit: 50_001,
				toMs: Date.parse(WINDOW.to),
				userId: "user-1",
			});
			expect(payload).toMatchObject({
				cachedThrough: "2026-09-19T00:00:00.000Z",
				dataSources: 2,
				method: "computed",
				source: "cache",
			});
			// Two years back, and nothing was moved: stored history is bounded by
			// what the sync fetched, not by the live window.
			expect(payload).not.toHaveProperty("historyClamped");
			// The phone's copy of the same walk is not added on top of the watch's.
			expect(payload.buckets).toEqual([
				expect.objectContaining({
					points: 2,
					values: { count: { avg: 750, max: 1200, min: 300, sum: 1500 } },
				}),
			]);
		});

		it("reads sleep on the overlap anchor and buckets it by its end", async () => {
			storedHistoryCovers("sleep");
			readHealthDataPoints.mockResolvedValue([
				{
					observedAtMs: Date.parse("2024-12-31T22:00:00Z"),
					observedEndMs: Date.parse("2025-01-01T06:00:00Z"),
					sourceKey: null,
					value: { summary: { minutesAsleep: "450" } },
				},
			]);

			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "sleep",
					granularity: "day",
					...WINDOW,
				}),
			);

			expect(readHealthDataPoints).toHaveBeenCalledWith(
				expect.objectContaining({ anchor: "overlap" }),
			);
			expect(payload.buckets).toEqual([
				expect.objectContaining({ start: "2025-01-01T00:00:00Z" }),
			]);
		});

		it("prefers stored history to a rollup when the window is covered", async () => {
			storedHistoryCovers("heart-rate");
			const client = googleClient();
			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "heart-rate",
					granularity: "day",
					...WINDOW,
				}),
			);
			expect(payload.source).toBe("cache");
			expect(client.rollUpDataPoints).not.toHaveBeenCalled();
		});

		it("falls back to Google when the window reaches past the coverage", async () => {
			storedHistoryCovers("steps");
			const client = googleClient();
			const payload = payloadOf(
				await aggregateHealthData(IDENTITY, {
					dataType: "steps",
					from: "2026-09-15T00:00:00Z",
					granularity: "day",
				}),
			);
			expect(payload.source).toBe("live");
			expect(client.rollUpDataPoints).toHaveBeenCalled();
		});

		it("refuses rather than aggregate the first fifty thousand points", async () => {
			storedHistoryCovers("heart-rate");
			readHealthDataPoints.mockResolvedValue(
				Array.from({ length: 50_001 }, () => ({})),
			);
			const result = await aggregateHealthData(IDENTITY, {
				dataType: "heart-rate",
				granularity: "day",
				...WINDOW,
			});
			expect(errorOf(result)).toContain("more than 50000 raw points");
		});
	});
});
