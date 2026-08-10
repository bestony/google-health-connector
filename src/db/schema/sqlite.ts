import { int, sqliteTable } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema — Turso (`libsql://`) and a local `file:` database alike.
 *
 * One of three siblings, one per dialect. They describe the same tables under
 * the same column *names*; only the types differ, because that is all that
 * changes between engines. Changing one without the others is what makes an app
 * work on SQLite and fall over on Postgres, so treat them as a set.
 *
 * Re-exporting the generated better-auth tables here is what makes
 * `drizzle-kit generate` pick them up — `drizzle.config.ts` points at this file
 * — and it keeps `pnpm auth:generate:sqlite` free to overwrite `./sqlite-auth.ts`
 * without touching anything below.
 */
export * from "./sqlite-auth";

export const helloTable = sqliteTable("hellos_table", {
	id: int().primaryKey({ autoIncrement: true }),
});
