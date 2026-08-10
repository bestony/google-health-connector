import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getAuthBaseUrl,
	getAuthSecret,
	getDatabaseConfig,
	getGoogleOAuthConfig,
	getLogLevel,
	isLevelEnabled,
	isProduction,
	redactConnectionString,
} from "./env.server";

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
		vi.unstubAllEnvs();
		expect(() => getAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
		vi.stubEnv("BETTER_AUTH_URL", " https://example.test/ ");
		expect(getAuthBaseUrl()).toBe("https://example.test/");
		vi.stubEnv("BETTER_AUTH_URL", " ");
		expect(getAuthBaseUrl()).toBe("http://localhost:3000");
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
		vi.unstubAllEnvs();
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
