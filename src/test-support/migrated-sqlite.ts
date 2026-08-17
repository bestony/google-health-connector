import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/**
 * A throwaway SQLite database with the committed migrations applied.
 *
 * Unit tests that construct a real better-auth instance and then *call* it can
 * no longer use `:memory:`. The OAuth provider seeds its resource registry from
 * `resources` during plugin `init`, and its "the table does not exist yet"
 * tolerance matches the driver's `no such table` against `error.message`.
 * drizzle-orm 1.x wraps driver errors in a `DrizzleQueryError` whose message is
 * the failed SQL and keeps the driver text on `cause`, so that tolerance never
 * matches here and an unmigrated database fails the request outright instead of
 * deferring the seed.
 *
 * Running the real migrations is also the more faithful fixture: it is the same
 * `drizzle/sqlite` lineage the application and the e2e profiles use.
 */
export interface MigratedSqlite {
	/** `DATABASE_URL` value naming the migrated database. */
	url: string;
	/** Removes the temporary directory. Safe to call more than once. */
	cleanup: () => void;
}

export async function createMigratedSqlite(): Promise<MigratedSqlite> {
	const directory = mkdtempSync(join(tmpdir(), "ghc-unit-sqlite-"));
	const url = `file:${join(directory, "unit.db")}`;
	const client = createClient({ url });

	try {
		await migrate(drizzle({ client }), { migrationsFolder: "drizzle/sqlite" });
	} finally {
		// The application opens its own client through `getDb()`; this one exists
		// only to apply the migrations.
		client.close();
	}

	return {
		url,
		cleanup: () => rmSync(directory, { recursive: true, force: true }),
	};
}
