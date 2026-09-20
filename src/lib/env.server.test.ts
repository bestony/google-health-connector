import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getAuthBaseUrl,
	getAuthSecret,
	getCronSecretConfig,
	getDatabaseConfig,
	getGoogleOAuthConfig,
	getHealthSyncBackfillDays,
	getHealthSyncBudgetMs,
	getHealthSyncDataTypes,
	getLogLevel,
	isHealthSyncEnabled,
	isLevelEnabled,
	isMcpOAuthEnabled,
	isProduction,
	redactConnectionString,
} from "./env.server";

// env.server.ts starts with `import "dotenv/config"`, so a developer's real
// .env leaks into process.env before any test runs. Scrub every variable the
// suite asserts on; unstubAllEnvs restores the real values afterwards.
const SCRUBBED_ENV_KEYS = [
	"DATABASE_URL",
	"TURSO_AUTH_TOKEN",
	"BETTER_AUTH_SECRET",
	"BETTER_AUTH_URL",
	"MCP_OAUTH_ENABLED",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
	"LOG_LEVEL",
	"NODE_ENV",
	"HEALTH_SYNC_ENABLED",
	"CRON_SECRET",
	"HEALTH_SYNC_BUDGET_MS",
	"HEALTH_SYNC_BACKFILL_DAYS",
	"HEALTH_SYNC_DATA_TYPES",
] as const;

beforeEach(() => {
	for (const key of SCRUBBED_ENV_KEYS) {
		vi.stubEnv(key, undefined);
	}
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("environment configuration", () => {
	it("requires a database URL and recognizes local SQLite", () => {
		vi.stubEnv("DATABASE_URL", ":memory:");
		expect(getDatabaseConfig()).toEqual({
			dialect: "sqlite",
			url: ":memory:",
			authToken: undefined,
		});

		vi.stubEnv("DATABASE_URL", "file:test.db");
		expect(getDatabaseConfig().dialect).toBe("sqlite");
	});

	it("rejects absent and unsupported database URLs", () => {
		expect(() => getDatabaseConfig()).toThrow(/DATABASE_URL/);
		vi.stubEnv("DATABASE_URL", "redis://localhost");
		expect(() => getDatabaseConfig()).toThrow(
			/Unsupported DATABASE_URL scheme/,
		);
	});

	it("requires a token for remote SQLite and returns other dialects", () => {
		vi.stubEnv("DATABASE_URL", "libsql://db.turso.io");
		expect(() => getDatabaseConfig()).toThrow(/TURSO_AUTH_TOKEN/);
		vi.stubEnv("TURSO_AUTH_TOKEN", "secret");
		expect(getDatabaseConfig()).toMatchObject({
			dialect: "sqlite",
			authToken: "secret",
		});

		vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
		expect(getDatabaseConfig()).toMatchObject({
			dialect: "postgresql",
			authToken: "secret",
		});
		vi.stubEnv("DATABASE_URL", "mysql://u:p@localhost/db");
		expect(getDatabaseConfig()).toMatchObject({
			dialect: "mysql",
			authToken: "secret",
		});
	});

	it("reads required secrets and public base URL", () => {
		vi.stubEnv("BETTER_AUTH_SECRET", "  secret  ");
		expect(getAuthSecret()).toBe("secret");
		// unstubAllEnvs would restore the developer's real .env values; clear
		// the single key instead so the missing-secret branch actually runs.
		vi.stubEnv("BETTER_AUTH_SECRET", undefined);
		expect(() => getAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
		vi.stubEnv("BETTER_AUTH_URL", " https://example.test/ ");
		expect(getAuthBaseUrl()).toBe("https://example.test/");
		vi.stubEnv("BETTER_AUTH_URL", " ");
		expect(getAuthBaseUrl()).toBe("http://localhost:3000");
	});

	it("enables MCP OAuth only through an explicit true value", () => {
		expect(isMcpOAuthEnabled()).toBe(false);
		vi.stubEnv("MCP_OAUTH_ENABLED", " TRUE ");
		expect(isMcpOAuthEnabled()).toBe(true);
		vi.stubEnv("MCP_OAUTH_ENABLED", "false");
		expect(isMcpOAuthEnabled()).toBe(false);
	});

	it("reports optional Google configuration and half-filled credentials", () => {
		expect(getGoogleOAuthConfig()).toEqual({
			status: "unconfigured",
			missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
		});
		vi.stubEnv("GOOGLE_CLIENT_ID", "client");
		expect(getGoogleOAuthConfig()).toEqual({
			status: "unconfigured",
			missing: ["GOOGLE_CLIENT_SECRET"],
		});
		vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
		vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
		expect(getGoogleOAuthConfig()).toEqual({
			status: "unconfigured",
			missing: ["GOOGLE_CLIENT_ID"],
		});
		vi.stubEnv("GOOGLE_CLIENT_ID", "client");
		expect(getGoogleOAuthConfig()).toEqual({
			status: "configured",
			clientId: "client",
			clientSecret: "secret",
		});
	});

	it("selects production defaults and explicit log levels", () => {
		vi.stubEnv("NODE_ENV", "production");
		expect(isProduction()).toBe(true);
		expect(getLogLevel()).toBe("error");
		expect(isLevelEnabled("error")).toBe(true);
		expect(isLevelEnabled("debug")).toBe(false);
		vi.stubEnv("LOG_LEVEL", " INFO ");
		expect(getLogLevel()).toBe("info");
		expect(isLevelEnabled("warn")).toBe(true);
		expect(isLevelEnabled("debug")).toBe(false);
		vi.stubEnv("LOG_LEVEL", "invalid");
		expect(getLogLevel()).toBe("error");
	});

	it("redacts URL credentials without normalizing shorthand URLs", () => {
		expect(redactConnectionString("postgres://user:password@host/db")).toBe(
			"postgres://user:***@host/db",
		);
		expect(
			redactConnectionString("libsql://db.turso.io?authToken=secret&x=1"),
		).toBe("libsql://db.turso.io?authToken=***&x=1");
		expect(redactConnectionString("file:test.db")).toBe("file:test.db");
	});
});

describe("background sync configuration", () => {
	it("fails closed unless HEALTH_SYNC_ENABLED is exactly true", () => {
		expect(isHealthSyncEnabled()).toBe(false);
		for (const value of ["", "1", "yes", "TRUE!", "true r"]) {
			vi.stubEnv("HEALTH_SYNC_ENABLED", value);
			expect(isHealthSyncEnabled()).toBe(false);
		}
		// `read()` trims, so surrounding whitespace is not a typo worth failing on.
		for (const value of ["true", "TRUE", "True", " true "]) {
			vi.stubEnv("HEALTH_SYNC_ENABLED", value);
			expect(isHealthSyncEnabled()).toBe(true);
		}
	});

	it("reports a missing CRON_SECRET by name rather than as an empty string", () => {
		// An enabled-but-secretless deployment has to refuse loudly; returning ""
		// would let it authenticate nobody against nothing.
		expect(getCronSecretConfig()).toEqual({
			missing: ["CRON_SECRET"],
			status: "unconfigured",
		});
		vi.stubEnv("CRON_SECRET", "   ");
		expect(getCronSecretConfig().status).toBe("unconfigured");
		vi.stubEnv("CRON_SECRET", " s3cret ");
		expect(getCronSecretConfig()).toEqual({
			secret: "s3cret",
			status: "configured",
		});
	});

	it("clamps the invocation budget instead of trusting it", () => {
		expect(getHealthSyncBudgetMs()).toBe(8_000);
		vi.stubEnv("HEALTH_SYNC_BUDGET_MS", "55000");
		expect(getHealthSyncBudgetMs()).toBe(55_000);
		// A budget under a second cannot finish anything; one over ten minutes
		// outlives every platform this deploys to.
		vi.stubEnv("HEALTH_SYNC_BUDGET_MS", "5");
		expect(getHealthSyncBudgetMs()).toBe(1_000);
		vi.stubEnv("HEALTH_SYNC_BUDGET_MS", "99999999");
		expect(getHealthSyncBudgetMs()).toBe(600_000);
		vi.stubEnv("HEALTH_SYNC_BUDGET_MS", "not-a-number");
		expect(getHealthSyncBudgetMs()).toBe(8_000);
		vi.stubEnv("HEALTH_SYNC_BUDGET_MS", "8000.9");
		expect(getHealthSyncBudgetMs()).toBe(8_000);
	});

	it("clamps the backfill window the same way", () => {
		expect(getHealthSyncBackfillDays()).toBe(730);
		vi.stubEnv("HEALTH_SYNC_BACKFILL_DAYS", "90");
		expect(getHealthSyncBackfillDays()).toBe(90);
		vi.stubEnv("HEALTH_SYNC_BACKFILL_DAYS", "0");
		expect(getHealthSyncBackfillDays()).toBe(1);
		vi.stubEnv("HEALTH_SYNC_BACKFILL_DAYS", "100000");
		expect(getHealthSyncBackfillDays()).toBe(3_650);
	});

	it("reads the data type allowlist as a list, empty by default", () => {
		expect(getHealthSyncDataTypes()).toEqual([]);
		vi.stubEnv("HEALTH_SYNC_DATA_TYPES", "steps, sleep");
		expect(getHealthSyncDataTypes()).toEqual(["steps", "sleep"]);
		vi.stubEnv("HEALTH_SYNC_DATA_TYPES", "steps\nsleep");
		expect(getHealthSyncDataTypes()).toEqual(["steps", "sleep"]);
		vi.stubEnv("HEALTH_SYNC_DATA_TYPES", "   ");
		expect(getHealthSyncDataTypes()).toEqual([]);
	});
});
