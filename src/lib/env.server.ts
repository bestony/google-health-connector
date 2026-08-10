import "dotenv/config";

/**
 * Server-side environment access.
 *
 * Every value is read from `process.env` lazily, inside a function, instead of
 * at module scope. Edge runtimes (Cloudflare Workers and friends) inject the
 * environment per request, so a module-level read would evaluate to `undefined`
 * there even on the server. Reading per call keeps this module portable and
 * makes the values trivially stubbable in tests.
 */

/** Log levels, ordered from most verbose to least. Mirrors better-auth's own levels. */
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_AUTH_BASE_URL = "http://localhost:3000";

function read(name: string): string | undefined {
	const value = process.env[name];
	return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function requireEnv(name: string): string {
	const value = read(name);
	if (value === undefined) {
		throw new Error(
			`[env] Missing required environment variable "${name}". Add it to your .env file.`,
		);
	}
	return value;
}

/** libsql connection string, e.g. `file:test.db` or a Turso `libsql://...` URL. */
export function getDatabaseUrl(): string {
	return requireEnv("DB_FILE_NAME");
}

/** Secret used by better-auth to sign sessions and tokens. Must never reach the client. */
export function getAuthSecret(): string {
	return requireEnv("BETTER_AUTH_SECRET");
}

/** Public origin the auth endpoints are served from. */
export function getAuthBaseUrl(): string {
	return read("BETTER_AUTH_URL") ?? DEFAULT_AUTH_BASE_URL;
}

/**
 * Google OAuth client credentials, or the list of variables that are missing.
 *
 * Google sign-in is deliberately optional: a checkout without credentials must
 * still boot and serve email + password sign-in. The `unconfigured` variant
 * carries the missing names so callers can tell the two failure modes apart —
 * both absent is a valid setup, exactly one absent is always a typo.
 *
 * A half-filled pair never yields credentials, so a misconfiguration surfaces
 * at start-up instead of as a `redirect_uri_mismatch` halfway through a login.
 */
export type GoogleOAuthConfig =
	| { status: "configured"; clientId: string; clientSecret: string }
	| { status: "unconfigured"; missing: string[] };

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
	const clientId = read("GOOGLE_CLIENT_ID");
	const clientSecret = read("GOOGLE_CLIENT_SECRET");

	if (clientId !== undefined && clientSecret !== undefined) {
		return { status: "configured", clientId, clientSecret };
	}

	const missing: string[] = [];
	if (clientId === undefined) missing.push("GOOGLE_CLIENT_ID");
	if (clientSecret === undefined) missing.push("GOOGLE_CLIENT_SECRET");
	return { status: "unconfigured", missing };
}

export function isProduction(): boolean {
	return read("NODE_ENV") === "production";
}

/**
 * Active log level. Defaults to `error` in production so only actionable
 * failures are emitted, and `debug` elsewhere so local debugging is verbose by
 * default. Override with `LOG_LEVEL=info` etc.
 */
export function getLogLevel(): LogLevel {
	const raw = read("LOG_LEVEL")?.toLowerCase();
	if (raw !== undefined && (LOG_LEVELS as readonly string[]).includes(raw)) {
		return raw as LogLevel;
	}
	return isProduction() ? "error" : "debug";
}

export function isLevelEnabled(level: LogLevel): boolean {
	return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(getLogLevel());
}

/**
 * Strip credentials out of a connection string so it can be logged safely.
 * `libsql://db.turso.io?authToken=secret` -> `libsql://db.turso.io?authToken=***`
 *
 * Done with string replacement rather than `new URL()` so that shorthand forms
 * such as `file:test.db` are echoed back verbatim instead of being normalised
 * into something that no longer matches what is in `.env`.
 */
export function redactConnectionString(url: string): string {
	return url
		.replace(/(:\/\/[^:/?#@]+):[^@]*@/, "$1:***@")
		.replace(/([?&](?:authToken|auth_token|token)=)[^&]*/gi, "$1***");
}
