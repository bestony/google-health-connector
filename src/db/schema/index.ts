import type { DatabaseDialect } from "../dialect";
import * as mysql from "./mysql";
import * as postgresql from "./postgresql";
import * as sqlite from "./sqlite";

/**
 * The Drizzle schema for each supported dialect, keyed the same way
 * `DATABASE_URL` resolves.
 *
 * All three are imported statically. They are table *descriptions* — no
 * connection, no driver, no I/O — so the two that are not in use cost a few
 * kilobytes and nothing else, and keeping them eagerly loaded is what lets
 * `getDb()` and `getAuth()` stay synchronous.
 *
 * `drizzle.config.ts` does not read this map: drizzle-kit wants a file path per
 * dialect, so it points at the sibling modules directly.
 */
export const SCHEMAS = { sqlite, postgresql, mysql } as const;

export type Schema = (typeof SCHEMAS)[DatabaseDialect];

export function getSchema(dialect: DatabaseDialect): Schema {
	return SCHEMAS[dialect];
}
