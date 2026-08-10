import { integer, pgTable } from "drizzle-orm/pg-core";

/**
 * PostgreSQL schema.
 *
 * One of three siblings, one per dialect — see `./sqlite.ts` for what that
 * means and why they move together. `./postgresql-auth.ts` is generated;
 * everything below is not.
 */
export * from "./postgresql-auth";

export const helloTable = pgTable("hellos_table", {
	id: integer().primaryKey().generatedAlwaysAsIdentity(),
});
