import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMigratedSqlite,
	type MigratedSqlite,
} from "../../test-support/migrated-sqlite";
import {
	OAUTH_METADATA_CORS_HEADERS,
	oauthMetadataHeadResponse,
	oauthMetadataOptionsResponse,
	oauthMetadataUnavailableResponse,
	protectedResourceMetadataResponse,
} from "./oauth-metadata";
import { MCP_OAUTH_ACCEPTED_SCOPES, MCP_OAUTH_SCOPE } from "./oauth-scopes";

let database: MigratedSqlite | undefined;

afterEach(async () => {
	// The auth instance memoizes a database handle; drop it before the directory
	// goes away so the next test does not reuse a client pointed at a dead file.
	const { resetDb } = await import("../../db/client.server");
	await resetDb();
	database?.cleanup();
	database = undefined;
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("OAuth metadata responses", () => {
	it("builds a browser-readable protected-resource document", async () => {
		const response = protectedResourceMetadataResponse(
			"https://health.example",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Content-Type")).toContain("application/json");
		expect(await response.json()).toMatchObject({
			resource: "https://health.example/mcp",
			authorization_servers: ["https://health.example"],
		});
	});

	it("keeps protected-resource and authorization-server scope sets distinct", async () => {
		// A migrated database, not `:memory:`: this test drives real provider
		// endpoints, and plugin init seeds the OAuth resource registry.
		database = await createMigratedSqlite();
		vi.stubEnv("DATABASE_URL", database.url);
		vi.stubEnv(
			"BETTER_AUTH_SECRET",
			"test-secret-at-least-thirty-two-characters",
		);
		vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
		vi.stubEnv("MCP_OAUTH_ENABLED", "true");
		vi.stubEnv("LOG_LEVEL", "error");

		const { getAuth } = await import("../auth.server");
		const authorizationServerResponse = await oauthProviderAuthServerMetadata(
			getAuth(),
		)(
			new Request(
				"http://localhost:3000/.well-known/oauth-authorization-server",
			),
		);
		const openIdResponse = await oauthProviderOpenIdConfigMetadata(getAuth())(
			new Request("http://localhost:3000/.well-known/openid-configuration"),
		);
		const protectedResourceResponse = protectedResourceMetadataResponse(
			"http://localhost:3000",
		);

		const authorizationServer = await authorizationServerResponse.json();
		const openId = await openIdResponse.json();
		const protectedResource = await protectedResourceResponse.json();

		expect(protectedResource.scopes_supported).toEqual([
			MCP_OAUTH_SCOPE,
			"offline_access",
		]);
		expect(protectedResource.scopes_supported).not.toContain("openid");
		expect(authorizationServer.scopes_supported).toEqual([
			...MCP_OAUTH_ACCEPTED_SCOPES,
		]);
		expect(authorizationServer.scopes_supported).toContain("openid");
		expect(openId.scopes_supported).toEqual(
			authorizationServer.scopes_supported,
		);
	});

	it("returns CORS preflight and fail-closed responses", async () => {
		const options = oauthMetadataOptionsResponse();
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Methods")).toBe(
			OAUTH_METADATA_CORS_HEADERS["Access-Control-Allow-Methods"],
		);

		const unavailable = oauthMetadataUnavailableResponse();
		expect(unavailable.status).toBe(404);
		expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
		expect(await unavailable.json()).toEqual({ error: "Not found" });
	});

	it("preserves metadata status and headers while removing a HEAD body", async () => {
		const response = protectedResourceMetadataResponse(
			"https://health.example",
		);
		const head = oauthMetadataHeadResponse(response);
		expect(head.status).toBe(200);
		expect(head.headers.get("Content-Type")).toContain("application/json");
		expect(await head.text()).toBe("");
	});
});
