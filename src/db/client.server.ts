import { createClient } from "@libsql/client";
import {
	drizzle as drizzleLibsql,
	type LibSQLDatabase,
} from "drizzle-orm/libsql";
import {
	drizzle as drizzleMysql,
	type MySql2Database,
} from "drizzle-orm/mysql2";
import {
	drizzle as drizzlePostgres,
	type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import { createPool } from "mysql2";
import {
	type DatabaseConfig,
	getDatabaseConfig,
	redactConnectionString,
} from "../lib/env.server";
import { createLogger } from "../lib/logger.server";

/**
 * Drizzle connection for whichever database `DATABASE_URL` names.
 *
 * Four databases, three dialects, one entry point. The dialect is decided in
 * `db/dialect.ts` from the URL scheme; everything downstream — driver, schema,
 * better-auth provider, migration folder — follows from it, so there is no
 * second place to keep in sync.
 *
 * All three drivers are imported statically rather than behind a dynamic
 * `import()`. That costs some bundle size for the two that go unused, and buys
 * a synchronous `getDb()`: `getAuth()` is synchronous, and every route and
 * server function reaches the database through it.
 *
 * The instance is created lazily on first use rather than at module scope so
 * that environment variables are read per request-lifetime (required on edge
 * runtimes) and so importing this module never opens a connection as a side
 * effect — which keeps it cheap to import from tests.
 */

const log = createLogger("db");

/**
 * Upper bound on connections held per process.
 *
 * Serverless multiplies this by the number of warm instances, and the driver
 * defaults (10 for `pg`) exhaust a small Postgres or MySQL surprisingly fast.
 * Past a handful of instances the answer is a pooler in front of the database —
 * PgBouncer, Neon's pooled endpoint, PlanetScale — not a larger number here.
 * libSQL is exempt: it is stateless HTTP and pools nothing.
 */
const MAX_POOL_CONNECTIONS = 5;

/**
 * Releases the underlying driver's connections.
 *
 * Only short-lived processes need it — the migration script, mainly. A `pg` or
 * `mysql2` pool keeps the Node event loop alive, so a script that skips this
 * finishes its work and then hangs.
 */
type CloseDatabase = () => Promise<void>;

/**
 * A connected database, tagged with the dialect it speaks.
 *
 * Discriminated rather than widened to a common supertype, because the callers
 * that matter — the better-auth adapter and the migrator — each need the
 * dialect *and* the concretely-typed handle together.
 */
export type DatabaseHandle =
	| { dialect: "sqlite"; db: LibSQLDatabase; close: CloseDatabase }
	| { dialect: "postgresql"; db: NodePgDatabase; close: CloseDatabase }
	| { dialect: "mysql"; db: MySql2Database; close: CloseDatabase };

/** Drizzle's query logger, wired to this app's logger at `debug`. */
const queryLogger = {
	logQuery(query: string, params: unknown[]) {
		log.debug("query", { query, params });
	},
};

function create(config: DatabaseConfig): DatabaseHandle {
	const { dialect, url, authToken } = config;
	log.info("creating drizzle client", {
		dialect,
		url: redactConnectionString(url),
		authenticated: authToken !== undefined,
	});

	switch (dialect) {
		case "sqlite": {
			// Built through `createClient` rather than drizzle's `connection`
			// shorthand because Turso's token is a field of its own: carrying it in
			// the URL query string instead would leak it into every log line that
			// echoes the connection string. The same client opens a local `file:`
			// database, so development and Turso share this branch.
			const client = createClient({ url, authToken });
			return {
				dialect,
				db: drizzleLibsql({ client, logger: queryLogger }),
				close: async () => {
					client.close();
				},
			};
		}

		case "postgresql": {
			const db = drizzlePostgres({
				connection: { connectionString: url, max: MAX_POOL_CONNECTIONS },
				logger: queryLogger,
			});
			return { dialect, db, close: () => db.$client.end() };
		}

		case "mysql": {
			// The callback-style pool from `mysql2`, not the one from
			// `mysql2/promise`. drizzle-orm 1.0.0-rc.4 sets `client.config
			// .supportBigNumbers` while constructing, and only the callback pool
			// exposes `config` — its own `connection: …` shorthand builds a promise
			// pool and throws on that line. It detects and wraps a callback pool
			// itself, so nothing downstream notices.
			const pool = createPool({
				uri: url,
				connectionLimit: MAX_POOL_CONNECTIONS,
			});
			return {
				dialect,
				db: drizzleMysql({ client: pool, logger: queryLogger }),
				close: () => pool.promise().end(),
			};
		}
	}
}

let instance: DatabaseHandle | undefined;

/** Memoized database handle. Safe to call from anywhere on the server. */
export function getDb(): DatabaseHandle {
	if (instance === undefined) {
		instance = create(getDatabaseConfig());
	}
	return instance;
}

/**
 * Close and drop the memoized handle. Intended for tests that swap the
 * database, and for anything short-lived that must not leave a pool open.
 */
export async function resetDb(): Promise<void> {
	if (instance === undefined) return;
	log.debug("resetting drizzle client");
	const closing = instance.close();
	instance = undefined;
	await closing;
}
