import { int, sqliteTable } from "drizzle-orm/sqlite-core";

/**
 * Schema entrypoint referenced by `drizzle.config.ts`.
 *
 * Re-exporting the auth tables here is what makes `drizzle-kit generate/push`
 * pick them up; application tables live below.
 */
export * from "./auth-schema";

export const helloTable = sqliteTable("hellos_table", {
	id: int().primaryKey({ autoIncrement: true }),
});
