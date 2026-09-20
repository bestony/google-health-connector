import "dotenv/config";
import {
	DATABASE_URL_EXAMPLES,
	type DatabaseDialect,
	detectDatabaseDialect,
	isLocalSqliteUrl,
} from "../db/dialect";

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

/** Commas or whitespace, for the one list-valued variable. */
const LIST_SEPARATOR = /[\s,]+/;

const DEFAULT_AUTH_BASE_URL = "http://localhost:3000";
const AUTH_IN_URL_PATTERN = /(:\/\/[^:/?#@]+):[^@]*@/;
const AUTH_QUERY_PARAMETER_PATTERN =
	/([?&](?:authToken|auth_token|token)=)[^&]*/gi;

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

/**
 * The database this deployment runs on.
 *
 * One variable decides everything: `DATABASE_URL`'s scheme selects the dialect,
 * and therefore the driver, the Drizzle schema, the better-auth adapter and the
 * migration folder. There is deliberately no second `DB_DIALECT` variable to
 * contradict it.
 *
 * PostgreSQL and MySQL carry their credentials in the URL itself. Only Turso
 * splits them out, because libSQL sends the token as a bearer header rather
 * than as part of the connection string.
 */
export interface DatabaseConfig {
	dialect: DatabaseDialect;
	url: string;
	/** Turso's bearer token. `undefined` for every dialect but remote libSQL. */
	authToken: string | undefined;
}

export function getDatabaseConfig(): DatabaseConfig {
	const url = read("DATABASE_URL");
	if (url === undefined) {
		// Named explicitly rather than left to `requireEnv`, because this variable
		// replaced `DB_FILE_NAME` and an already-deployed environment is exactly
		// where this error gets hit.
		throw new Error(
			'[env] Missing required environment variable "DATABASE_URL" (it replaced ' +
				`"DB_FILE_NAME"). One of: ${DATABASE_URL_EXAMPLES.join(", ")}.`,
		);
	}

	const dialect = detectDatabaseDialect(url);
	if (dialect === undefined) {
		throw new Error(
			`[env] Unsupported DATABASE_URL scheme in "${redactConnectionString(url)}". ` +
				`Expected one of: ${DATABASE_URL_EXAMPLES.join(", ")}.`,
		);
	}

	const authToken = read("TURSO_AUTH_TOKEN");
	if (
		dialect === "sqlite" &&
		authToken === undefined &&
		!isLocalSqliteUrl(url)
	) {
		// A remote libSQL URL without a token fails as an opaque 401 on the first
		// query, long after start-up and usually inside an unrelated request.
		// Refusing here turns it into one legible line in the deploy log.
		throw new Error(
			'[env] Missing required environment variable "TURSO_AUTH_TOKEN". ' +
				`It is required for the remote database "${redactConnectionString(url)}" ` +
				"(`turso db tokens create <name>`). Only `file:` URLs may omit it.",
		);
	}

	return { dialect, url, authToken };
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
 * Whether this deployment exposes the MCP OAuth authorization server.
 *
 * Missing and unrecognized values fail closed. Enabling OAuth before its
 * additive tables and discovery routes are deployed would publish an
 * authorization flow that cannot complete, so only an explicit `true` turns
 * it on.
 */
export function isMcpOAuthEnabled(): boolean {
	return read("MCP_OAUTH_ENABLED")?.toLowerCase() === "true";
}

/**
 * Whether this deployment runs the scheduled Google Health sync.
 *
 * Missing and unrecognized values fail closed, for the same reason
 * `isMcpOAuthEnabled()` does — and with more at stake. The sync calls Google on
 * behalf of every opted-in user without anybody asking it to, and it writes to
 * cache tables that a not-yet-migrated deployment does not have. Only an
 * explicit `true` turns it on; until then the cron routes answer 404.
 */
export function isHealthSyncEnabled(): boolean {
	return read("HEALTH_SYNC_ENABLED")?.toLowerCase() === "true";
}

/**
 * The shared secret the scheduler authenticates with, or why it is unusable.
 *
 * Named `CRON_SECRET` rather than something this app chose, because Vercel
 * attaches `Authorization: Bearer $CRON_SECRET` to its own cron invocations
 * when — and only when — a variable of exactly that name exists on the project.
 * Renaming it would mean hand-rolling the header on the one platform that
 * already provides it.
 *
 * The `unconfigured` variant exists so that an enabled-but-secretless
 * deployment refuses with a 503 naming the variable, rather than either running
 * unauthenticated or looking like a route that was never deployed.
 */
export type CronSecretConfig =
	| { status: "configured"; secret: string }
	| { status: "unconfigured"; missing: string[] };

export function getCronSecretConfig(): CronSecretConfig {
	const secret = read("CRON_SECRET");
	return secret === undefined
		? { status: "unconfigured", missing: ["CRON_SECRET"] }
		: { status: "configured", secret };
}

/** Clamps a numeric variable, falling back when it is missing or unreadable. */
function readNumber(
	name: string,
	fallback: number,
	min: number,
	max: number,
): number {
	const raw = read(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * The wall-clock budget for one sync invocation.
 *
 * Must sit under the platform's function timeout with room for the run to
 * finish its own bookkeeping — the default is 8 seconds because Vercel's Hobby
 * tier kills a function at 10. Self-hosted deployments have no such ceiling and
 * should raise it; `deployment/` says so.
 */
export function getHealthSyncBudgetMs(): number {
	return readNumber("HEALTH_SYNC_BUDGET_MS", 8_000, 1_000, 600_000);
}

/**
 * How far back the backfill may reach, in days.
 *
 * Two years by default. This is also the history a cached MCP read may serve:
 * data the sync never fetched cannot be read from the cache, so the floor and
 * the read window are the same number by construction rather than by
 * coincidence.
 *
 * A user's `Profile.membershipStartDate` overrides it when that is more recent,
 * because there is nothing older than that to fetch.
 */
export function getHealthSyncBackfillDays(): number {
	return readNumber("HEALTH_SYNC_BACKFILL_DAYS", 730, 1, 3_650);
}

/**
 * Data types to sync, or empty for all of them.
 *
 * An escape hatch for an operator who wants a smaller sync, not a place to
 * encode which types a user can read — that is discovered by probing, because
 * Google publishes no mapping from data types onto consent categories.
 * Unrecognized ids are dropped downstream rather than rejected here, so a
 * typo narrows the sync instead of breaking start-up.
 */
export function getHealthSyncDataTypes(): string[] {
	const raw = read("HEALTH_SYNC_DATA_TYPES");
	if (raw === undefined) return [];
	return raw
		.split(LIST_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
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
		.replace(AUTH_IN_URL_PATTERN, "$1:***@")
		.replace(AUTH_QUERY_PARAMETER_PATTERN, "$1***");
}
