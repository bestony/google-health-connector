import { type Config, defineConfig } from "drizzle-kit";
import { getDatabaseConfig } from "./src/lib/env.server";

/**
 * drizzle-kit configuration (`generate`, `push`, `studio`).
 *
 * Everything here follows from `DATABASE_URL`: the dialect decides which schema
 * file is read and which migration folder is written, so pointing the variable
 * at a Postgres server and running `pnpm db:generate` produces the Postgres
 * migration and touches nothing else.
 *
 * Credentials come from `env.server.ts` rather than from `process.env` here, so
 * that the CLI and the running app cannot disagree about which database they
 * are pointed at, and so a missing variable fails with the same message in both.
 * That module loads `dotenv/config` itself.
 *
 * Applying migrations is *not* drizzle-kit's job in this project — see
 * `scripts/migrate.ts`, which is what runs on deploy.
 */
const { dialect, url, authToken } = getDatabaseConfig();

/** Shared regardless of dialect: one schema file and one folder per dialect. */
const paths = {
	schema: `./src/db/schema/${dialect}.ts`,
	out: `./drizzle/${dialect}`,
} satisfies Pick<Config, "schema" | "out">;

function createDialectConfig(): Config {
	if (dialect === "sqlite") {
		return {
			...paths,
			// `turso`, not `sqlite`: it is the dialect that knows how to send an
			// auth token and speak libSQL's HTTP protocol. It drives a local
			// `file:` database just as well, so both SQLite deployments share one
			// snapshot lineage instead of drifting apart.
			dialect: "turso",
			dbCredentials: { url, authToken },
		};
	}

	if (dialect === "postgresql") {
		return { ...paths, dialect: "postgresql", dbCredentials: { url } };
	}

	return { ...paths, dialect: "mysql", dbCredentials: { url } };
}

export default defineConfig(createDialectConfig());
