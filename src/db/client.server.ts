import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { getDatabaseUrl, redactConnectionString } from "../lib/env.server";
import { createLogger } from "../lib/logger.server";

/**
 * Drizzle + libSQL (SQLite) connection.
 *
 * The instance is created lazily on first use rather than at module scope so
 * that environment variables are read per request-lifetime (required on edge
 * runtimes) and so importing this module never opens a connection as a side
 * effect — which keeps it cheap to import from tests.
 */

const log = createLogger("db");

export type Db = LibSQLDatabase;

let instance: Db | undefined;

function create(): Db {
	const url = getDatabaseUrl();
	log.info("creating drizzle client", { url: redactConnectionString(url) });

	return drizzle({
		connection: { url },
		logger: {
			logQuery(query, params) {
				log.debug("query", { query, params });
			},
		},
	});
}

/** Memoized Drizzle client. Safe to call from anywhere on the server. */
export function getDb(): Db {
	if (instance === undefined) {
		instance = create();
	}
	return instance;
}

/** Drop the memoized client. Intended for tests that swap the database file. */
export function resetDb(): void {
	log.debug("resetting drizzle client");
	instance = undefined;
}
