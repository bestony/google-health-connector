import { expect, test } from "./fixtures/test";

test.describe("@production deployed read-only smoke", () => {
	test("the deployed home page and legal pages are reachable", async ({
		request,
	}) => {
		const paths = ["/", "/privacy", "/terms"];
		const responses = await Promise.all(
			paths.map((path) =>
				request.get(path, {
					headers: { Accept: "text/html" },
				}),
			),
		);
		for (const [index, response] of responses.entries()) {
			const path = paths[index];
			expect(response.status(), path).toBe(200);
		}
	});

	test("an anonymous deployed dashboard visit preserves its redirect", async ({
		request,
	}) => {
		const response = await request.get("/dashboard", {
			maxRedirects: 0,
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(307);
		expect(response.headers().location).toContain("/login?redirect=");
	});

	test("the deployed MCP endpoint challenges anonymous callers", async ({
		request,
	}) => {
		const response = await request.post("/mcp", {
			headers: {
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
			},
			data: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
		});
		expect(response.status()).toBe(401);
		expect(response.headers()["www-authenticate"]).toContain("Bearer");
	});
});
