/**
 * Which SQL dialect a connection string asks for.
 *
 * The dialect is derived from the URL scheme rather than configured separately,
 * so a deployment cannot end up pointing a Postgres driver at a MySQL server:
 * there is only one variable to get right, and it already carries the answer.
 *
 * Three dialects cover the four supported databases — Turso and a local SQLite
 * file are the same dialect over different transports, and `@libsql/client`
 * picks the transport from the same scheme.
 *
 * Keep this module free of imports: `drizzle.config.ts`, the migration script,
 * the server and the browser-safe schema map all read it.
 */

export const DATABASE_DIALECTS = ["sqlite", "postgresql", "mysql"] as const;

export type DatabaseDialect = (typeof DATABASE_DIALECTS)[number];

/**
 * Scheme (including the colon, as `URL.protocol` reports it) → dialect.
 *
 * `http`/`https`/`ws`/`wss` map to SQLite because they are libSQL's alternative
 * transports, which `@libsql/client` accepts alongside `libsql:`. Nothing else
 * in this app is ever handed a database URL, so there is no ambiguity to lose.
 */
const DIALECT_BY_SCHEME: Readonly<Record<string, DatabaseDialect>> = {
	"file:": "sqlite",
	"libsql:": "sqlite",
	"http:": "sqlite",
	"https:": "sqlite",
	"ws:": "sqlite",
	"wss:": "sqlite",
	"postgres:": "postgresql",
	"postgresql:": "postgresql",
	"mysql:": "mysql",
	"mariadb:": "mysql",
};

/** libSQL's in-process database. Not a URL, so it never reaches `new URL()`. */
const IN_MEMORY_URL = ":memory:";

/**
 * Whether this URL is served from inside the process rather than over a
 * network — the two forms that need no credentials of any kind.
 */
export function isLocalSqliteUrl(url: string): boolean {
	return url.startsWith("file:") || url === IN_MEMORY_URL;
}

/**
 * The dialect `url` names, or `undefined` when its scheme is not one of ours.
 *
 * Returns rather than throws so the caller can raise the error with the context
 * it has — the variable name, mostly, which is the only part a reader can act on.
 */
export function detectDatabaseDialect(
	url: string,
): DatabaseDialect | undefined {
	if (url === IN_MEMORY_URL) return "sqlite";

	let protocol: string;
	try {
		protocol = new URL(url).protocol;
	} catch {
		// A connection string with no scheme at all (`localhost:5432`, a bare
		// path). Nothing to dispatch on.
		return undefined;
	}

	return DIALECT_BY_SCHEME[protocol];
}

/**
 * Example URLs, one per supported database, for error messages. Written out
 * rather than derived from the map above, because `file:` takes no `//` and a
 * reader needs the shape of the whole string, not just its scheme.
 */
export const DATABASE_URL_EXAMPLES: readonly string[] = [
	"file:test.db",
	"libsql://<db>.turso.io",
	"postgres://user:password@host:5432/db",
	"mysql://user:password@host:3306/db",
];
