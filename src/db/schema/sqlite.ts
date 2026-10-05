/**
 * SQLite schema — Turso (`libsql://`) and a local `file:` database alike.
 *
 * Re-exporting the generated better-auth tables here is what makes
 * `drizzle-kit generate` pick them up — `drizzle.config.ts` points at this file
 * — and it keeps `pnpm auth:generate:sqlite` free to overwrite `./sqlite-auth.ts`
 * without touching this module.
 *
 * Any application table added later belongs in all three dialect modules under
 * the same table and column *names*; only the types differ. They move as a set
 * — editing one alone is what produces an app that works on SQLite and falls
 * over on Postgres.
 */
export * from "./sqlite-auth";
