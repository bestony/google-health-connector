import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMigratedSqlite,
	type MigratedSqlite,
} from "../test-support/migrated-sqlite";
import { MCP_OAUTH_TOKEN_LIFETIME } from "./mcp/oauth-scopes";

let database: MigratedSqlite | undefined;

/**
 * Constructing the auth instance starts better-auth's plugin `init`, which the
 * OAuth provider uses to seed its resource registry. Nothing here awaits that
 * work, so an unmigrated database would surface as an unhandled rejection
 * rather than a failed assertion.
 */
async function stubOAuthEnvironment() {
	database = await createMigratedSqlite();
	vi.stubEnv("DATABASE_URL", database.url);
	vi.stubEnv(
		"BETTER_AUTH_SECRET",
		"test-secret-at-least-thirty-two-characters",
	);
	vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
	vi.stubEnv("MCP_OAUTH_ENABLED", "true");
	vi.stubEnv("LOG_LEVEL", "error");
}

afterEach(async () => {
	const { resetDb } = await import("../db/client.server");
	await resetDb();
	database?.cleanup();
	database = undefined;
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("MCP OAuth token lifetime", () => {
	it("configures the provider with the thirty-day grant", async () => {
		await stubOAuthEnvironment();

		const { getAuth } = await import("./auth.server");
		const oauthPlugin = getAuth().options.plugins?.find(
			(plugin) => plugin.id === "oauth-provider",
		);

		// The provider defaults to a one-hour access token, which is the failure
		// this configuration exists to prevent: an MCP client that does not run
		// the refresh-token grant would be sent back through consent hourly.
		expect(oauthPlugin?.options).toMatchObject({
			accessTokenExpiresIn: MCP_OAUTH_TOKEN_LIFETIME.accessTokenSeconds,
			refreshTokenExpiresIn: MCP_OAUTH_TOKEN_LIFETIME.refreshTokenSeconds,
			refreshTokenReuseInterval:
				MCP_OAUTH_TOKEN_LIFETIME.refreshTokenReuseSeconds,
		});
	});

	it("lets the OAuth access token outlive the browser session", async () => {
		await stubOAuthEnvironment();

		const { getAuth } = await import("./auth.server");
		const options = getAuth().options;

		// The grant is owned by the consent row, not by the cookie session. If the
		// session ever outgrew the token this assertion would be meaningless, so it
		// is pinned in the direction that matters.
		expect(MCP_OAUTH_TOKEN_LIFETIME.accessTokenSeconds).toBeGreaterThan(
			options.session?.expiresIn ?? 0,
		);
	});

	it("does not let the JWT plugin cap the access token", async () => {
		await stubOAuthEnvironment();

		const { getAuth } = await import("./auth.server");
		const jwtPlugin = getAuth().options.plugins?.find(
			(plugin) => plugin.id === "jwt",
		);

		// `signJWT` honours an `exp` already present in the payload and only falls
		// back to `jwt.expirationTime` (default 15 minutes) when there is none. The
		// OAuth provider always supplies `exp` from `accessTokenExpiresIn`, so this
		// must stay unset — setting it here would silently look authoritative.
		expect(
			(jwtPlugin?.options as { jwt?: { expirationTime?: unknown } } | undefined)
				?.jwt?.expirationTime,
		).toBeUndefined();
	});
});
