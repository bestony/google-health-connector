import { request as playwrightRequest } from "@playwright/test";
import { waitForReactControl } from "./fixtures/guards";
import { initializeRequest, mcpPost } from "./fixtures/mcp";
import { expect, test } from "./fixtures/test";

const RESOURCE_METADATA_PATTERN = /resource_metadata="([^"]+)"/;

test.describe("OAuth-disabled surface", () => {
	test("DISC-14 OAuth endpoint surface is absent with the switch off", async ({
		request,
	}) => {
		const paths = [
			"/api/auth/oauth2/register",
			"/api/auth/oauth2/authorize",
			"/api/auth/oauth2/token",
			"/api/auth/oauth2/revoke",
			"/api/auth/oauth2/introspect",
			"/api/auth/jwks",
			"/api/auth/token",
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
			expect(response.status(), paths[index]).toBe(404);
		}
	});

	test("DISC-25 Connected apps degrades instead of claiming no approvals", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		await addSession(context, await signUp());
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "Connected apps" });
		await waitForReactControl(tab);
		await tab.click();
		await expect(
			page.getByText("could not be read", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByText("No application has been approved", { exact: false }),
		).toHaveCount(0);
	});

	test("DISC-26 unsigned consent remains a public inert page", async ({
		request,
	}) => {
		const response = await request.get("/consent", {
			maxRedirects: 0,
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		expect(await response.text()).toContain("No authorization request");
	});
});

test.describe("@oauth OAuth-enabled discovery surface", () => {
	test("DISC-04 authorization metadata advertises only supported flows", async ({
		request,
		profile,
	}) => {
		const response = await request.get(
			"/.well-known/oauth-authorization-server",
		);
		expect(response.status()).toBe(200);
		const metadata = (await response.json()) as Record<string, unknown>;
		expect(metadata).toMatchObject({
			issuer: profile.baseURL,
			authorization_endpoint: `${profile.baseURL}/api/auth/oauth2/authorize`,
			token_endpoint: `${profile.baseURL}/api/auth/oauth2/token`,
			registration_endpoint: `${profile.baseURL}/api/auth/oauth2/register`,
			jwks_uri: `${profile.baseURL}/api/auth/jwks`,
			code_challenge_methods_supported: ["S256"],
			response_types_supported: ["code"],
		});
		expect(metadata.scopes_supported).toEqual(
			expect.arrayContaining(["openid", "offline_access", "mcp:health:read"]),
		);
		expect(metadata.grant_types_supported).toEqual([
			"authorization_code",
			"client_credentials",
			"refresh_token",
		]);
	});

	test("DISC-11 a client can walk the full chain from the MCP challenge", async ({
		request,
	}) => {
		const challengeResponse = await mcpPost(request, initializeRequest);
		const challenge = challengeResponse.headers()["www-authenticate"] ?? "";
		const metadataMatch = challenge.match(RESOURCE_METADATA_PATTERN);
		expect(metadataMatch?.[1]).toBeTruthy();

		const resource = await request.get(metadataMatch?.[1] ?? "invalid");
		expect(resource.status()).toBe(200);
		const resourceBody = (await resource.json()) as {
			authorization_servers?: string[];
		};
		const issuer = resourceBody.authorization_servers?.[0];
		expect(issuer).toBeTruthy();

		const authorization = await request.get(
			`${issuer}/.well-known/oauth-authorization-server`,
		);
		expect(authorization.status()).toBe(200);
		const authorizationBody = (await authorization.json()) as {
			jwks_uri?: string;
		};
		const jwks = await request.get(authorizationBody.jwks_uri ?? "invalid");
		expect(jwks.status()).toBe(200);
		await expect(jwks.json()).resolves.toMatchObject({
			keys: expect.any(Array),
		});
	});

	test("DISC-12 a different request hostname does not alter issuer metadata", async ({
		profile,
		request,
	}) => {
		const port = new URL(profile.baseURL).port;
		const isolated = await playwrightRequest.newContext({
			baseURL: `http://localhost:${port}`,
		});
		try {
			const [alternateResponse, canonicalResponse] = await Promise.all([
				isolated.get("/.well-known/oauth-protected-resource/mcp"),
				request.get("/.well-known/oauth-protected-resource/mcp"),
			]);
			expect(alternateResponse.status()).toBe(200);
			const alternateText = await alternateResponse.text();
			const canonicalText = await canonicalResponse.text();
			expect(alternateText).toBe(canonicalText);
			const body = JSON.parse(alternateText) as {
				resource?: string;
				authorization_servers?: string[];
			};
			expect(body.resource).toBe(`${profile.baseURL}/mcp`);
			expect(body.authorization_servers).toEqual([profile.baseURL]);
		} finally {
			await isolated.dispose();
		}
	});

	test("OAUTH-04 dynamic registration creates a public PKCE client", async ({
		request,
		profile,
	}) => {
		const response = await request.post("/api/auth/oauth2/register", {
			headers: {
				Origin: profile.baseURL,
				"x-forwarded-for": "10.70.1.1",
			},
			data: {
				client_name: "E2E public client",
				redirect_uris: [`${profile.baseURL}/terms`],
				token_endpoint_auth_method: "none",
				application_type: "native",
			},
		});
		expect(response.status()).toBe(201);
		const client = (await response.json()) as Record<string, unknown>;
		expect(client.client_id).toEqual(expect.any(String));
		expect(client.application_type).toBe("native");
		expect(client.token_endpoint_auth_method).toBe("none");
		expect(client.client_secret).toBeUndefined();
		expect(client.scope).toContain("mcp:health:read");
	});

	test("DISC-22 registration refuses unsafe redirect schemes", async ({
		request,
		profile,
	}) => {
		const response = await request.post("/api/auth/oauth2/register", {
			headers: {
				Origin: profile.baseURL,
				"x-forwarded-for": "10.70.2.1",
			},
			data: {
				client_name: "Unsafe E2E client",
				redirect_uris: ["javascript:alert(1)"],
				token_endpoint_auth_method: "none",
			},
		});
		expect(response.status()).toBe(400);
	});

	test("DISC-20 metadata is anonymous and user-invariant", async ({
		request,
		signUp,
	}) => {
		const account = await signUp();
		const [anonymous, authenticated] = await Promise.all([
			request.get("/.well-known/openid-configuration", {
				headers: { Cookie: "" },
			}),
			request.get("/.well-known/openid-configuration", {
				headers: {
					Cookie: `${account.cookieName}=${account.sessionCookie}`,
				},
			}),
		]);
		expect(await anonymous.text()).toBe(await authenticated.text());
	});
});
