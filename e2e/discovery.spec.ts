import { expect, test } from "./fixtures/test";

const protectedResourcePaths = [
	"/.well-known/oauth-protected-resource",
	"/.well-known/oauth-protected-resource/mcp",
];

test.describe("OAuth discovery kill switch", () => {
	test("DISC-13 discovery is absent when MCP OAuth is disabled", async ({
		request,
	}) => {
		const paths = [
			...protectedResourcePaths,
			"/.well-known/oauth-authorization-server",
			"/.well-known/openid-configuration",
		];
		const responses = await Promise.all(
			paths.map((path) =>
				request.get(path, {
					maxRedirects: 0,
					headers: { Accept: "application/json" },
				}),
			),
		);
		for (const [index, response] of responses.entries()) {
			const path = paths[index];
			expect(response.status(), path).toBe(404);
			expect(response.headers()["cache-control"], path).toBe("no-store");
		}
	});

	test("DISC-14 disabled discovery answers CORS preflight as not found", async ({
		request,
	}) => {
		const response = await request.fetch(
			"/.well-known/oauth-protected-resource/mcp",
			{
				method: "OPTIONS",
				headers: { Origin: "https://client.example" },
			},
		);
		expect(response.status()).toBe(404);
	});
});

test.describe("@oauth OAuth discovery documents", () => {
	test("DISC-02 all four documents are mounted and CORS-readable", async ({
		request,
		profile,
	}) => {
		const paths = [
			...protectedResourcePaths,
			"/.well-known/oauth-authorization-server",
			"/.well-known/openid-configuration",
		];
		const responses = await Promise.all(
			paths.map((path) =>
				request.get(path, {
					headers: {
						Accept: "application/json",
						Origin: "https://client.example",
					},
				}),
			),
		);
		for (const [index, response] of responses.entries()) {
			const path = paths[index];
			expect(response.status(), path).toBe(200);
			expect(response.headers()["access-control-allow-origin"], path).toBe("*");
		}
		const resource = await request.get(protectedResourcePaths[1]);
		const body = (await resource.json()) as {
			resource?: string;
			authorization_servers?: string[];
			scopes_supported?: string[];
		};
		expect(body.resource).toBe(`${profile.baseURL}/mcp`);
		expect(body.authorization_servers).toEqual([profile.baseURL]);
		expect(body.scopes_supported).toEqual([
			"mcp:health:read",
			"offline_access",
		]);
	});

	test("DISC-03 discovery HEAD keeps headers but has no body", async ({
		request,
	}) => {
		const response = await request.fetch(
			"/.well-known/oauth-protected-resource/mcp",
			{ method: "HEAD" },
		);
		expect(response.status()).toBe(200);
		expect(await response.body()).toHaveLength(0);
		expect(response.headers()["cache-control"]).toContain("max-age=15");
	});
});
