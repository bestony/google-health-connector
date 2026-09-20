import { type SQL, sql } from "drizzle-orm";
import type { DatabaseHandle } from "./client.server";

/**
 * The parts of a cross-dialect upsert that are the same whatever table it
 * targets.
 *
 * Only the *reference to the incoming row* actually differs between the three
 * engines, and it differs in a way that is easy to get wrong silently. This
 * module is where that difference is written down once, so the modules that
 * dispatch on `handle.dialect` carry table references and nothing else.
 */

/**
 * SQLite and PostgreSQL name the incoming row `excluded`.
 *
 * Both also need an explicit conflict target, which the caller supplies.
 */
export const excluded = (column: string): SQL =>
	sql`excluded.${sql.identifier(column)}`;

/**
 * MySQL has no `excluded` alias and needs `VALUES()`.
 *
 * Deprecated since MySQL 8.0.20 in favour of a row alias Drizzle does not
 * emit; it still works and only warns. Do not "fix" this to `excluded`, which
 * is a syntax error on MySQL, and do not replace either with plain values —
 * `set: { value: row.value }` writes the *last* row's value onto every
 * conflicting row of a multi-row insert, which is a silent corruption rather
 * than an error.
 *
 * MySQL also takes no conflict target: `ON DUPLICATE KEY UPDATE` fires on
 * whichever unique key collided. That is why every table here has exactly one.
 */
export const incoming = (column: string): SQL =>
	sql`values(${sql.identifier(column)})`;

/**
 * Builds the `set` clause of an upsert from a list of column keys.
 *
 * Driving it off a list rather than spelling out each assignment means the
 * three dialect branches cannot drift from one another, and adding a column to
 * a table is one edit rather than three.
 */
export function refreshedColumns<Key extends string>(
	table: Record<Key, { name: string }>,
	columns: readonly Key[],
	reference: (column: string) => SQL,
): Record<string, SQL> {
	return Object.fromEntries(
		columns.map((key) => [key, reference(table[key].name)]),
	);
}

/**
 * How many rows go into one INSERT, per dialect.
 *
 * SQLite caps bound parameters at 32766 and the widest row here is fifteen
 * columns, so 200 rows is 3000 parameters with room to spare. PostgreSQL's
 * wire protocol caps at 65535, and MySQL's `max_allowed_packet` sees roughly
 * 350 KB for a thousand rows of this shape — both comfortable at 1000.
 */
export const INSERT_CHUNK_SIZE = {
	mysql: 1000,
	postgresql: 1000,
	sqlite: 200,
} as const satisfies Record<DatabaseHandle["dialect"], number>;

/** Splits `items` into runs of at most `size`. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}
