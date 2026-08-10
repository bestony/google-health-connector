import { int, mysqlTable } from "drizzle-orm/mysql-core";

/**
 * MySQL schema.
 *
 * One of three siblings, one per dialect — see `./sqlite.ts` for what that
 * means and why they move together. `./mysql-auth.ts` is generated; everything
 * below is not.
 */
export * from "./mysql-auth";

export const helloTable = mysqlTable("hellos_table", {
	id: int().primaryKey().autoincrement(),
});
