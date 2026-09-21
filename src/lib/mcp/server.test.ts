import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";
import { createMcpServer } from "./server";

const {
	FakeAuthorizationError,
	FakeGoogleHealthApiError,
	createGoogleHealthClient,
	getAuthBaseUrl,
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
	class HoistedAuthorizationError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "GoogleHealthAuthorizationError";
		}
	}
	return {
		FakeAuthorizationError: HoistedAuthorizationError,
		FakeGoogleHealthApiError: HoistedGoogleHealthApiError,
		createGoogleHealthClient: vi.fn(),
		getAuthBaseUrl: vi.fn(() => "https://connector.example///"),
		getHealthSyncBackfillDays: vi.fn(() => 730),
		isHealthSyncEnabled: vi.fn(() => false),
		readHealthDataPoints: vi.fn(async () => []),
		readHealthSyncAccount: vi.fn(async () => undefined),
		readHealthSyncStates: vi.fn(async () => []),
	};
});

vi.mock("../env.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../env.server")>();
	return {
		...actual,
		getAuthBaseUrl,
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
	GoogleHealthAuthorizationError: FakeAuthorizationError,
}));

async function connected(identity: Parameters<typeof createMcpServer>[0]) {
	const server = createMcpServer(identity);
	const client = new Client({ name: "test-client", version: "1.0.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await Promise.all([
		server.connect(serverTransport),
		client.connect(clientTransport),
	]);
	return { server, client };
}

type ToolContent = { type: string; text?: string };

function resultContents(result: unknown): ToolContent[] {
	return (result as { content: ToolContent[] }).content;
}

function resultText(result: unknown): string {
	return (
		resultContents(result).find((item) => item.type === "text")?.text ?? ""
	);
}

function resultJson(result: unknown) {
	return JSON.parse(resultText(result)) as Record<string, unknown>;
}

describe("MCP server", () => {
	beforeEach(() => {
		getAuthBaseUrl.mockClear();
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

	it("lists types and readable categories for an authenticated caller", async () => {
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});
		const result = await client.callTool({
			name: "list_health_data_types",
			arguments: {},
		});
		expect(result.isError).not.toBe(true);
		const payload = resultJson(result);
		expect(Array.isArray(payload.dataTypes)).toBe(true);
		expect(payload.readableCategories).toEqual(
			expect.arrayContaining(["sleep"]),
		);
	});

	it("advertises the aggregate tool and validates its arguments", async () => {
		const rollUpDataPoints = vi.fn(async () => [
			{
				endTime: "2026-09-02T00:00:00Z",
				startTime: "2026-09-01T00:00:00Z",
				steps: { countSum: "9000" },
			},
		]);
		createGoogleHealthClient.mockReturnValue({ rollUpDataPoints });
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});

		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name)).toEqual([
			"list_health_data_types",
			"read_health_data",
			"aggregate_health_data",
			"get_health_profile",
		]);

		const listed = resultJson(
			await client.callTool({ name: "list_health_data_types", arguments: {} }),
		);
		expect(listed.aggregateOnlyDataTypes).toContain("total-calories");

		const rejected = await client.callTool({
			name: "aggregate_health_data",
			arguments: { dataType: "steps", granularity: "week" },
		});
		expect(rejected.isError).toBe(true);
		expect(rollUpDataPoints).not.toHaveBeenCalled();

		const payload = resultJson(
			await client.callTool({
				name: "aggregate_health_data",
				arguments: {
					dataType: "steps",
					from: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
					granularity: "day",
				},
			}),
		);
		expect(payload.method).toBe("google-rollup");
		expect(payload.bucketCount).toBe(1);
	});

	it("lets a scoped OAuth identity use all tools as its subject", async () => {
		createGoogleHealthClient.mockReturnValue({
			collectDataPoints: vi.fn(async () => []),
			getProfile: vi.fn(async () => ({ heightCm: "180" })),
			getSettings: vi.fn(async () => ({ distanceUnit: "km" })),
		});
		const { client } = await connected({
			authenticated: true,
			via: "oauth",
			userId: "oauth-user",
			clientId: "oauth-client",
			scopes: [MCP_OAUTH_SCOPE],
		});

		const listed = await client.callTool({
			name: "list_health_data_types",
			arguments: {},
		});
		const read = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		const profile = await client.callTool({
			name: "get_health_profile",
			arguments: {},
		});

		expect(listed.isError).not.toBe(true);
		expect(read.isError).not.toBe(true);
		expect(profile.isError).not.toBe(true);
		expect(createGoogleHealthClient).toHaveBeenCalledTimes(2);
		expect(createGoogleHealthClient).toHaveBeenCalledWith({
			userId: "oauth-user",
		});
	});

	it("refuses every tool before the network when OAuth scope is missing", async () => {
		const { client } = await connected({
			authenticated: true,
			via: "oauth",
			userId: "oauth-user",
			clientId: "oauth-client",
			scopes: ["openid"],
		});

		const results = await Promise.all([
			client.callTool({
				name: "list_health_data_types",
				arguments: {},
			}),
			client.callTool({
				name: "read_health_data",
				arguments: { dataType: "steps" },
			}),
			client.callTool({
				name: "get_health_profile",
				arguments: {},
			}),
		]);

		for (const result of results) {
			expect(result.isError).toBe(true);
			expect(resultText(result)).toContain(MCP_OAUTH_SCOPE);
		}
		expect(createGoogleHealthClient).not.toHaveBeenCalled();
	});

	it("reads data, clamps history and reports malformed dates", async () => {
		const collectDataPoints = vi.fn(async () => [
			{
				name: "point-1",
				steps: {
					count: "10",
					interval: { startTime: "2026-08-09T00:00:00Z" },
				},
			},
		]);
		createGoogleHealthClient.mockReturnValue({ collectDataPoints });
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});

		const invalid = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps", from: "nope" },
		});
		expect(invalid.isError).toBe(true);
		expect(resultText(invalid)).toContain("`from` is not a date");

		const result = await client.callTool({
			name: "read_health_data",
			arguments: {
				dataType: "steps",
				from: "2020-01-01T00:00:00Z",
				limit: 1,
			},
		});
		const payload = resultJson(result);
		expect(payload.historyClamped).toContain("history window");
		expect(payload.count).toBe(1);
		expect(payload.truncated).toBe(true);
		expect(collectDataPoints).toHaveBeenCalledWith("steps", {
			from: expect.any(Date),
			to: undefined,
			limit: 1,
		});

		const recent = await client.callTool({
			name: "read_health_data",
			arguments: {
				dataType: "steps",
				from: "2026-08-09T00:00:00Z",
				to: "2026-08-10T00:00:00Z",
			},
		});
		expect(resultJson(recent).historyClamped).toBeUndefined();
		expect(resultJson(recent).truncated).toBe(false);
	});

	it("maps authorization and API failures to model-readable errors", async () => {
		createGoogleHealthClient.mockReturnValue({
			collectDataPoints: vi.fn(async () => {
				throw new FakeGoogleHealthApiError(
					403,
					"forbidden",
					"PERMISSION_DENIED",
				);
			}),
			grantedScopes: vi.fn(async () => [
				"https://www.googleapis.com/auth/googlehealth.sleep.readonly",
			]),
		});
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});
		const permission = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(permission.isError).toBe(true);
		expect(resultText(permission)).toContain("PERMISSION_DENIED");

		createGoogleHealthClient.mockReturnValue({
			collectDataPoints: vi.fn(async () => {
				throw new FakeAuthorizationError("Reconnect Google");
			}),
		});
		const authFailure = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(resultText(authFailure)).toContain("Reconnect Google");
	});

	it("handles empty granted scopes and retryable or generic failures", async () => {
		const collectDataPoints = vi
			.fn()
			.mockRejectedValueOnce(
				new FakeGoogleHealthApiError(401, "expired", "UNAUTHENTICATED"),
			)
			.mockRejectedValueOnce(
				new FakeGoogleHealthApiError(500, "temporarily down"),
			)
			.mockRejectedValueOnce(new Error("bad data type"))
			.mockRejectedValueOnce("string failure");
		const grantedScopes = vi
			.fn()
			.mockRejectedValue(new Error("scope lookup failed"));
		createGoogleHealthClient.mockReturnValue({
			collectDataPoints,
			grantedScopes,
		});
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});

		const unauthorized = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(resultText(unauthorized)).toContain("nothing yet");
		const retryable = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(resultText(retryable)).toContain("worth retrying");
		const generic = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(resultText(generic)).toContain("bad data type");
		const stringFailure = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(resultText(stringFailure)).toContain("string failure");
	});

	it("returns profile and tolerates missing optional settings", async () => {
		createGoogleHealthClient.mockReturnValue({
			getProfile: vi.fn(async () => ({ heightCm: "180" })),
			getSettings: vi.fn(async () => {
				throw new Error("settings unavailable");
			}),
		});
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});
		const result = await client.callTool({
			name: "get_health_profile",
			arguments: {},
		});
		expect(resultJson(result)).toEqual({
			profile: { heightCm: "180" },
			settings: null,
		});
	});

	it("returns a readable error when the profile call fails", async () => {
		createGoogleHealthClient.mockReturnValue({
			getProfile: vi.fn(async () => {
				throw new FakeGoogleHealthApiError(
					400,
					"invalid profile",
					"INVALID_ARGUMENT",
				);
			}),
			getSettings: vi.fn(async () => ({})),
		});
		const { client } = await connected({
			authenticated: true,
			userId: "user-1",
			keyId: "key-1",
		});
		const result = await client.callTool({
			name: "get_health_profile",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(resultText(result)).toContain("INVALID_ARGUMENT");

		createGoogleHealthClient.mockReturnValue({
			getProfile: vi.fn(async () => {
				throw "profile string failure";
			}),
			getSettings: vi.fn(async () => ({})),
		});
		const stringResult = await client.callTool({
			name: "get_health_profile",
			arguments: {},
		});
		expect(resultText(stringResult)).toContain("profile string failure");
	});
});

describe("read_health_data and the stored history", () => {
	// A sibling describe does not inherit the block above's beforeEach, and these
	// mocks are module-level, so they have to be reset here too.
	beforeEach(() => {
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

	const IDENTITY = {
		authenticated: true as const,
		keyId: "key-1",
		userId: "user-1",
	};
	const WINDOW = {
		from: "2025-01-01T00:00:00Z",
		to: "2025-02-01T00:00:00Z",
	};

	/** Opted in, with the window fully covered. */
	function optedIn(
		coverage = {
			coveredFromMs: Date.parse("2024-01-01T00:00:00Z"),
			coveredThroughMs: Date.parse("2026-09-18T00:00:00Z"),
		},
	) {
		isHealthSyncEnabled.mockReturnValue(true);
		readHealthSyncAccount.mockResolvedValue({ enabled: true } as never);
		readHealthSyncStates.mockResolvedValue([
			{ dataType: "steps", ...coverage },
		] as never);
	}

	function liveClient(points: unknown[] = []) {
		const collectDataPoints = vi.fn(async () => points);
		createGoogleHealthClient.mockReturnValue({ collectDataPoints });
		return collectDataPoints;
	}

	it("serves a covered window from the cache without calling Google", async () => {
		optedIn();
		readHealthDataPoints.mockResolvedValue([
			{
				dataType: "steps",
				observedAtMs: Date.parse("2025-01-02T00:00:00Z"),
				observedEndMs: Date.parse("2025-01-02T00:15:00Z"),
				resourceName: null,
				value: { count: "1200" },
			},
		] as never);
		const { client } = await connected(IDENTITY);

		const result = await client.callTool({
			arguments: { dataType: "steps", ...WINDOW },
			name: "read_health_data",
		});

		const payload = resultJson(result);
		expect(payload.source).toBe("cache");
		expect(payload.count).toBe(1);
		expect(createGoogleHealthClient).not.toHaveBeenCalled();
		expect(payload.dataPoints).toEqual([
			{
				end: "2025-01-02T00:15:00.000Z",
				start: "2025-01-02T00:00:00.000Z",
				type: "steps",
				value: { count: "1200" },
			},
		]);
	});

	it("reads sleep from the cache on the overlap anchor", async () => {
		optedIn();
		readHealthSyncStates.mockResolvedValue([
			{
				coveredFromMs: Date.parse("2024-01-01T00:00:00Z"),
				coveredThroughMs: Date.parse("2026-09-18T00:00:00Z"),
				dataType: "sleep",
			},
		] as never);
		const { client } = await connected(IDENTITY);

		await client.callTool({
			arguments: { dataType: "sleep", ...WINDOW },
			name: "read_health_data",
		});

		// A night that began before the window is the normal case for sleep.
		expect(readHealthDataPoints).toHaveBeenCalledWith(
			expect.objectContaining({ anchor: "overlap", dataType: "sleep" }),
		);
	});

	it("falls back to Google when the window is not fully covered", async () => {
		optedIn({
			coveredFromMs: Date.parse("2025-01-15T00:00:00Z"),
			coveredThroughMs: Date.parse("2026-09-18T00:00:00Z"),
		});
		const collect = liveClient();
		const { client } = await connected(IDENTITY);

		const payload = resultJson(
			await client.callTool({
				arguments: { dataType: "steps", ...WINDOW },
				name: "read_health_data",
			}),
		);

		expect(payload.source).toBe("live");
		expect(collect).toHaveBeenCalled();
		expect(readHealthDataPoints).not.toHaveBeenCalled();
	});

	it("falls back to Google for an open-ended request", async () => {
		// No upper bound means "up to now", and the sync deliberately stops at
		// D-2, so this can never be fully covered.
		optedIn();
		liveClient();
		const { client } = await connected(IDENTITY);

		const payload = resultJson(
			await client.callTool({
				arguments: { dataType: "steps", from: WINDOW.from },
				name: "read_health_data",
			}),
		);

		expect(payload.source).toBe("live");
		expect(readHealthDataPoints).not.toHaveBeenCalled();
	});

	it("falls back to Google for a user who never opted in", async () => {
		isHealthSyncEnabled.mockReturnValue(true);
		readHealthSyncAccount.mockResolvedValue({ enabled: false } as never);
		liveClient();
		const { client } = await connected(IDENTITY);

		const payload = resultJson(
			await client.callTool({
				arguments: { dataType: "steps", ...WINDOW },
				name: "read_health_data",
			}),
		);

		expect(payload.source).toBe("live");
		expect(readHealthSyncStates).not.toHaveBeenCalled();
	});

	it("never touches the cache tables when the sync is off entirely", async () => {
		liveClient();
		const { client } = await connected(IDENTITY);

		await client.callTool({
			arguments: { dataType: "steps", ...WINDOW },
			name: "read_health_data",
		});

		expect(readHealthSyncAccount).not.toHaveBeenCalled();
		expect(readHealthDataPoints).not.toHaveBeenCalled();
	});

	it("clamps a live read to ninety days and a cached one to the backfill floor", async () => {
		const collect = liveClient();
		const { client: liveOnly } = await connected(IDENTITY);
		const live = resultJson(
			await liveOnly.callTool({
				arguments: {
					dataType: "steps",
					from: "2000-01-01T00:00:00Z",
					to: WINDOW.to,
				},
				name: "read_health_data",
			}),
		);
		expect(live.historyClamped).toContain("90-day");
		expect(collect).toHaveBeenCalled();

		// The cache only holds what the sync fetched, so the backfill floor is
		// the entitlement — enforced when the data was written.
		optedIn({
			coveredFromMs: Date.parse("2000-01-01T00:00:00Z"),
			coveredThroughMs: Date.parse("2026-09-18T00:00:00Z"),
		});
		getHealthSyncBackfillDays.mockReturnValue(3650);
		const { client: cached } = await connected(IDENTITY);
		const payload = resultJson(
			await cached.callTool({
				arguments: {
					dataType: "steps",
					from: "2020-01-01T00:00:00Z",
					to: WINDOW.to,
				},
				name: "read_health_data",
			}),
		);
		expect(payload.source).toBe("cache");
		expect(payload.historyClamped).toBeUndefined();
	});
});
