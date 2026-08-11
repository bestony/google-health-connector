/**
 * SQLite schema — Turso (`libsql://`) and a local `file:` database alike.
 *
 * Re-exporting the generated better-auth tables here is what makes
 * `drizzle-kit generate` pick them up — `drizzle.config.ts` points at this file
 * — and it keeps `pnpm auth:generate:sqlite` free to overwrite `./sqlite-auth.ts`
 * without touching this module.
 */
export * from "./sqlite-auth";
