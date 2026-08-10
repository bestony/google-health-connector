import { existsSync } from "node:fs";
import { migrate as migrateSqlite } from "drizzle-orm/libsql/migrator";
import type {
	MigrationConfig,
	MigratorInitFailResponse,
} from "drizzle-orm/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate as migrateMysql } from "drizzle-orm/mysql2/migrator";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import { type DatabaseHandle, getDb } from "../src/db/client.server";
import { createLogger } from "../src/lib/logger.server";

/**
 * Applies pending migrations to whichever database `DATABASE_URL` names.
 *
 * This is what runs on deploy (see the `vercel-build` script), which is why it
 * goes through drizzle-orm's programmatic migrator rather than `drizzle-kit
 * migrate`: it needs no dev dependency at run time beyond `tsx`, it reports
 * through this app's logger, and it closes its connections so a build step
 * cannot hang on an open pool.
 *
 * Both paths write the same `__drizzle_migrations` bookkeeping that drizzle-kit
 * does, so `pnpm db:migrate` locally and the deploy are interchangeable.
 *
 *   pnpm db:migrate              apply everything pending
 *   pnpm db:baseline             record migration #1 as applied, running nothing
 *
 * Baseline exists for a database whose tables were created by `drizzle-kit
 * push`, which leaves no bookkeeping behind: a plain migrate would then try to
 * `CREATE TABLE` over tables that already exist and fail. It is only ever
 * correct when the database really is at the schema that migration describes.
 */

const log = createLogger("db:migrate");

const BASELINE_FLAG = "--baseline";

/**
 * `init` is drizzle's baseline switch. It is honoured by all three migrators but
 * missing from the exported `MigrationConfig` type, so it is declared here
 * rather than forced through with a cast at the call site.
 */
interface MigrateConfig extends MigrationConfig {
	init?: boolean;
}

/** Dispatches to the migrator for the dialect, keeping the handle's typing. */
function runMigrator(
	handle: DatabaseHandle,
	config: MigrateConfig,
): Promise<MigratorInitFailResponse | void> {
	switch (handle.dialect) {
		case "sqlite":
			return migrateSqlite(handle.db, config);
		case "postgresql":
			return migratePostgres(handle.db, config);
		case "mysql":
			return migrateMysql(handle.db, config);
	}
}

async function main(): Promise<void> {
	const baseline = process.argv.includes(BASELINE_FLAG);
	const handle = getDb();
	const migrationsFolder = `drizzle/${handle.dialect}`;

	if (!existsSync(migrationsFolder)) {
		throw new Error(
			`No migrations for the "${handle.dialect}" dialect: "${migrationsFolder}" does not exist. ` +
				"Run `pnpm db:generate` with DATABASE_URL pointing at this dialect, and commit the result.",
		);
	}

	// Read up front so the log says what is about to happen even when the
	// migrator itself has nothing to do.
	const migrations = readMigrationFiles({ migrationsFolder });
	log.info(baseline ? "baselining database" : "applying migrations", {
		dialect: handle.dialect,
		migrationsFolder,
		migrations: migrations.map((migration) => migration.name),
	});

	try {
		const result = await runMigrator(handle, {
			migrationsFolder,
			...(baseline ? { init: true } : {}),
		});

		// Only a baseline returns anything, and only when it declined to act.
		if (result?.exitCode === "databaseMigrations") {
			log.warn("nothing to baseline: this database is already tracked", {
				hint: "Run `pnpm db:migrate` instead.",
			});
		} else if (result?.exitCode === "localMigrations") {
			throw new Error(
				`Cannot baseline: ${migrations.length} migrations exist locally and drizzle can only ` +
					"record the first. Point this at a database created by `drizzle-kit push` from the " +
					"initial schema, or recreate the database and run `pnpm db:migrate`.",
			);
		} else {
			log.info(baseline ? "baseline recorded" : "migrations applied", {
				dialect: handle.dialect,
			});
		}
	} finally {
		// A `pg`/`mysql2` pool keeps the event loop alive; without this the build
		// step hangs after the work is done.
		await handle.close();
	}
}

main().catch((error: unknown) => {
	log.error("migration failed", {
		error: error instanceof Error ? (error.stack ?? error.message) : String(error),
	});
	process.exitCode = 1;
});
