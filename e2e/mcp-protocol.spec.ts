import {
	initializeRequest,
	mcpPost,
	rawMcpPost,
	rpcBody,
} from "./fixtures/mcp";
import { expect, test } from "./fixtures/test";

test.describe("MCP HTTP transport", () => {
	test("@smoke MCP-01 anonymous POST returns the RFC 9728 challenge", async ({
		request,
		profile,
	}) => {
		const response = await mcpPost(request, initializeRequest);
		expect(response.status()).toBe(401);
		expect(response.headers()["www-authenticate"]).toContain(
			`resource_metadata="${profile.baseURL}/.well-known/oauth-protected-resource/mcp"`,
		);
		expect(response.headers()["access-control-expose-headers"]).toContain(
			"WWW-Authenticate",
		);
		await expect(rpcBody(response)).resolves.toMatchObject({
			jsonrpc: "2.0",
			error: { code: -32001 },
			id: null,
		});
	});

	test("MCP-02 non-POST methods advertise Allow: POST", async ({ request }) => {
		const responses = await Promise.all(
			(["get", "delete"] as const).map((method) =>
				request[method]("/mcp", {
					maxRedirects: 0,
					headers: { Accept: "application/json" },
				}),
			),
		);
		for (const response of responses) {
			expect(response.status()).toBe(405);
			expect(response.headers().allow).toBe("POST");
			// biome-ignore lint/performance/noAwaitInLoops: Each response has a distinct JSON-RPC contract.
			await expect(rpcBody(response)).resolves.toMatchObject({
				error: { code: -32000 },
			});
		}
	});

	test("MCP-04 invalid API keys are rejected without an OAuth challenge", async ({
		request,
	}) => {
		const response = await mcpPost(request, initializeRequest, {
			apiKey: "ghc_invalid-key",
		});
		expect(response.status()).toBe(401);
		expect(response.headers()["www-authenticate"]).toBeUndefined();
		await expect(rpcBody(response)).resolves.toMatchObject({
			error: { code: -32001, message: "Invalid API key." },
			id: null,
		});
	});

	test("@smoke MCP-11 a valid key reaches initialize and tools/list", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const account = await signUp();
		const issued = await apiKey(account);
		const initialized = await mcpPost(request, initializeRequest, {
			apiKey: issued.key,
		});
		expect(initialized.status()).toBe(200);
		await expect(rpcBody(initialized)).resolves.toMatchObject({
			result: { serverInfo: { name: "ghealth-connector" } },
			id: 1,
		});

		const listed = await mcpPost(
			request,
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{ apiKey: issued.key },
		);
		expect(listed.status()).toBe(200);
		const body = await rpcBody(listed);
		expect(body.result).toMatchObject({
			tools: expect.arrayContaining([
				expect.objectContaining({ name: "list_health_data_types" }),
			]),
		});
	});

	test("MCP-12 transport rejects a single JSON Accept value", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const issued = await apiKey(await signUp());
		const response = await rawMcpPost(request, initializeRequest, {
			Accept: "application/json",
			"Content-Type": "application/json",
			"x-api-key": issued.key,
		});
		expect(response.status()).toBe(406);
		const body = await rpcBody(response);
		expect(body.error).toEqual(expect.objectContaining({ code: -32000 }));
	});

	test("MCP-13 malformed JSON returns a protocol error after authentication", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const issued = await apiKey(await signUp());
		const response = await request.post("/mcp", {
			headers: {
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
				"x-api-key": issued.key,
			},
			data: "{not-json",
		});
		expect([400, 500]).toContain(response.status());
		const body = await rpcBody(response);
		expect(body).toHaveProperty("error");
		expect(body).toHaveProperty("id", null);
	});
});
