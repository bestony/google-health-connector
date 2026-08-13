import { initializeRequest, mcpPost, rpcBody } from "./fixtures/mcp";
import { expect, test } from "./fixtures/test";

interface CredentialRow {
	name: string;
	headers: Record<string, string>;
	message: string;
	challenge: boolean;
}

test.describe("MCP credential and protocol contracts", () => {
	test("INFRA-08 canonical credential refusal matrix", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const validKey = (await apiKey(await signUp())).key;
		const rows: CredentialRow[] = [
			{
				name: "malformed bearer",
				headers: { Authorization: "Bearer" },
				message: "Authorization: Bearer must include",
				challenge: false,
			},
			{
				name: "opaque bearer",
				headers: { Authorization: "Bearer opaque-access-token" },
				message: "accepts only JWT access tokens",
				challenge: true,
			},
			{
				name: "OAuth token in API key header",
				headers: { "x-api-key": "header.payload.signature" },
				message: "OAuth access tokens must use Authorization",
				challenge: true,
			},
			{
				name: "unsupported scheme beats valid key",
				headers: { Authorization: "DPoP xyz", "x-api-key": validKey },
				message: "Authorization must use the Bearer scheme",
				challenge: false,
			},
			{
				name: "OAuth shaped bearer while disabled",
				headers: { Authorization: "Bearer header.payload.signature" },
				message: "OAuth access tokens are not enabled",
				challenge: true,
			},
			{
				name: "invalid API key",
				headers: { "x-api-key": "ghc_invalid" },
				message: "Invalid API key",
				challenge: false,
			},
		];
		const responses = await Promise.all(
			rows.map((row) =>
				request.post("/mcp", {
					headers: {
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
						...row.headers,
					},
					data: initializeRequest,
				}),
			),
		);
		for (const [index, response] of responses.entries()) {
			const row = rows[index];
			expect(response.status(), row?.name).toBe(401);
			// biome-ignore lint/performance/noAwaitInLoops: Each refusal body is paired with its matrix row.
			const body = await rpcBody(response);
			expect(
				(body.error as { message?: unknown }).message,
				row?.name,
			).toContain(row?.message);
			expect(
				response.headers()["www-authenticate"] !== undefined,
				row?.name,
			).toBe(row?.challenge);
		}
	});

	test("MCP-12 transport enforces media types and JSON-RPC shape", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const key = (await apiKey(await signUp())).key;
		const unsupported = await request.fetch("/mcp", {
			method: "POST",
			headers: {
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${key}`,
				"Content-Type": "text/plain",
			},
			data: JSON.stringify(initializeRequest),
		});
		expect(unsupported.status()).toBe(415);

		const invalidRpc = await request.post("/mcp", {
			headers: {
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			data: { hello: "world" },
		});
		expect(invalidRpc.status()).toBe(400);
		await expect(rpcBody(invalidRpc)).resolves.toMatchObject({
			error: { code: -32700 },
		});
	});

	test("COV-10 every request is stateless and receives no MCP session id", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const key = (await apiKey(await signUp())).key;
		const responses = await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				mcpPost(
					request,
					{ jsonrpc: "2.0", id: index + 1, method: "tools/list" },
					{ apiKey: key },
				),
			),
		);
		for (const [index, response] of responses.entries()) {
			expect(response.status()).toBe(200);
			expect(response.headers()["mcp-session-id"]).toBeUndefined();
			// biome-ignore lint/performance/noAwaitInLoops: Response ids are checked against their request order.
			expect((await rpcBody(response)).id).toBe(index + 1);
		}
	});

	test("HEALTH-24 read_health_data gives an actionable reconnect response", async ({
		request,
		profile,
		apiKey,
		signUp,
	}) => {
		const key = (await apiKey(await signUp())).key;
		const response = await mcpPost(
			request,
			{
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: { name: "read_health_data", arguments: { dataType: "steps" } },
			},
			{ apiKey: key },
		);
		expect(response.status()).toBe(200);
		const body = await rpcBody(response);
		const result = body.result as {
			isError?: boolean;
			content?: Array<{ text?: string }>;
		};
		expect(result.isError).toBe(true);
		expect(result.content?.[0]?.text).toContain("Google");
		expect(result.content?.[0]?.text).toContain(`${profile.baseURL}/dashboard`);
	});

	test("MCP-17 list_health_data_types is a real authenticated tool", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const key = (await apiKey(await signUp())).key;
		const response = await mcpPost(
			request,
			{
				jsonrpc: "2.0",
				id: 8,
				method: "tools/call",
				params: { name: "list_health_data_types", arguments: {} },
			},
			{ apiKey: key },
		);
		expect(response.status()).toBe(200);
		const body = await rpcBody(response);
		const result = body.result as { content?: Array<{ text?: string }> };
		const payload = JSON.parse(result.content?.[0]?.text ?? "null") as {
			dataTypes?: unknown[];
			readableCategories?: unknown[];
		};
		expect(payload.dataTypes?.length).toBeGreaterThan(0);
		expect(payload.readableCategories?.length).toBeGreaterThan(0);
	});
});
