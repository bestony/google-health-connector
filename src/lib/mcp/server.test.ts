import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./server";

const {
	FakeAuthorizationError,
	FakeGoogleHealthApiError,
	createGoogleHealthClient,
	getAuthBaseUrl,
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
	};
});

vi.mock("../env.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../env.server")>();
	return { ...actual, getAuthBaseUrl };
});
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
	});

	it("allows discovery and gives anonymous callers an actionable refusal", async () => {
		const { client } = await connected({ authenticated: false });
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name)).toEqual([
			"list_health_data_types",
			"read_health_data",
			"get_health_profile",
		]);
		const result = await client.callTool({
			name: "list_health_data_types",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(resultContents(result)[0]).toMatchObject({ type: "text" });
		expect(resultText(result)).toContain("https://connector.example/dashboard");
		const profile = await client.callTool({
			name: "get_health_profile",
			arguments: {},
		});
		expect(profile.isError).toBe(true);
		const read = await client.callTool({
			name: "read_health_data",
			arguments: { dataType: "steps" },
		});
		expect(read.isError).toBe(true);
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
