import { and, type Column, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { HealthCacheRecord } from "../lib/google-health-cache-record.server";
import { createLogger } from "../lib/logger.server";
import { getDb } from "./client.server";
import { healthDataPoint as mysqlPoints } from "./schema/mysql";
import { healthDataPoint as postgresqlPoints } from "./schema/postgresql";
import { healthDataPoint as sqlitePoints } from "./schema/sqlite";
import {
	chunked,
	excluded,
	INSERT_CHUNK_SIZE,
	incoming,
	refreshedColumns,
} from "./upsert.server";

/**
 * Every read and write of cached Google Health data points.
 *
 * This and its `health-sync-state.server.ts` sibling are the first modules in
 * the app to query Drizzle directly — everything else goes through
 * better-auth, which is dialect-agnostic by construction. The cache cannot be:
 * `getDb()` hands back a discriminated union whose three `db` values are
 * structurally identical but nominally unrelated types, so every operation
 * needs a `switch`. Three rules keep that from turning into thirty query
 * builders:
 *
 * 1. **The row object is dialect-agnostic, and is built once.** All three
 *    tables use the same column names and the same JS value types, so one
 *    `HealthCacheRecord[]` typechecks against all three `.values()`.
 * 2. **Predicates are shared through structural typing.** `eq`/`gte`/`lt`/`and`
 *    accept any `Column`, so one builder taking a bag of columns serves all
 *    three tables.
 * 3. **The switch keeps the handle undestructured and each branch is a single
 *    chained expression** — the `runMigrator` pattern in `scripts/migrate.ts`.
 *    A branch carries a table reference and no decisions.
 *
 * A generic cross-dialect query layer was considered and rejected: it fights
 * Drizzle's types, and the mess it would save is smaller than the mess it
 * would be. What genuinely is shared lives in `upsert.server.ts`.
 *
 * `scripts/health-cache-roundtrip.ts` exercises every function below against
 * whichever database `DATABASE_URL` names, which is how the three branches are
 * checked; a unit test with a stubbed handle would assert the switch picked a
 * table and prove nothing about the SQL it emitted.
 */

const log = createLogger("db");

/** How many points a single cache read returns when the caller does not say. */
const DEFAULT_READ_LIMIT = 1000;

/**
 * How far before a window a point may have started and still overlap it.
 *
 * This bounds the lower end of the index range for an overlap query. Without
 * it, "started before `to` and did not end before `from`" has no lower bound
 * and degenerates into scanning every point the user has of that type.
 * Thirty-six hours covers the longest session this API produces — a sleep or
 * an exercise — with room to spare.
 */
export const OVERLAP_LOOKBACK_MS = 36 * 60 * 60 * 1000;

/**
 * Which end of a point decides whether it falls in a window.
 *
 * `start` is a plain index range, and right for samples, intervals and daily
 * summaries. `overlap` additionally catches a point that began before the
 * window and ended inside it, which for sessions — sleep above all — is the
 * normal case rather than the exception. Same reason `google-health-filter.ts`
 * redirects sleep's live filter to `interval.end_time`.
 */
export type HealthPointAnchor = "start" | "overlap";

export interface HealthPointQuery {
	userId: string;
	dataType: string;
	/** Inclusive lower bound, epoch ms. */
	fromMs: number;
	/** Exclusive upper bound, epoch ms. */
	toMs: number;
	anchor?: HealthPointAnchor;
	grain?: string;
	limit?: number;
}

export interface StoredHealthPoint {
	id: string;
	dataType: string;
	grain: string;
	timeShape: string;
	observedAtMs: number;
	observedEndMs: number;
	observedTime: Record<string, unknown>;
	value: Record<string, unknown>;
	source: Record<string, unknown> | null;
	sourceKey: string | null;
	resourceName: string | null;
}

/** The columns a window predicate needs, whichever dialect's table supplies them. */
interface HealthPointColumns {
	userId: Column;
	dataType: Column;
	grain: Column;
	observedAtMs: Column;
	observedEndMs: Column;
}

/**
 * A point is in the window when it starts before `toMs` and, under the overlap
 * anchor, did not end before `fromMs`.
 *
 * A zero-length sample exactly at `fromMs` is included, and so is an interval
 * ending exactly at `fromMs`. Both are one-instant edge cases, and stating the
 * rule is worth more than a stricter rule nobody can recall.
 */
function healthPointWindow(
	table: HealthPointColumns,
	query: HealthPointQuery,
): SQL {
	const anchored =
		query.anchor === "overlap"
			? [
					gte(table.observedAtMs, query.fromMs - OVERLAP_LOOKBACK_MS),
					gte(table.observedEndMs, query.fromMs),
				]
			: [gte(table.observedAtMs, query.fromMs)];

	return and(
		eq(table.userId, query.userId),
		eq(table.dataType, query.dataType),
		eq(table.grain, query.grain ?? "point"),
		lt(table.observedAtMs, query.toMs),
		...anchored,
	) as SQL;
}

/**
 * The columns an upsert refreshes.
 *
 * `id` and `user_id` are the identity and `created_at` records first sight, so
 * rewriting either would defeat the point. `synced_at` is always refreshed: it
 * is the run stamp the prune sweep reads to tell a row this run saw from one
 * it did not.
 */
const REFRESHED_POINT_COLUMNS = [
	"dataType",
	"grain",
	"timeShape",
	"observedAtMs",
	"observedEndMs",
	"observedTime",
	"value",
	"source",
	"sourceKey",
	"resourceName",
	"contentHash",
	"syncedAt",
] as const;

/**
 * Writes points, replacing any row already carrying the same identity.
 *
 * The conflict action must be UPDATE and never DO NOTHING. The daily sync
 * deliberately re-reads days it has already covered, so that a measurement
 * Google corrected after the fact is corrected here too; DO NOTHING would make
 * the cache permanently disagree with Google about any edited point.
 */
export async function upsertHealthDataPoints(
	records: readonly HealthCacheRecord[],
): Promise<number> {
	if (records.length === 0) return 0;
	const handle = getDb();

	for (const chunk of chunked(records, INSERT_CHUNK_SIZE[handle.dialect])) {
		// Chunking exists to stay under each driver's bound-parameter ceiling, so
		// the chunks are one statement's worth of the same insert rather than
		// independent work. Issuing them together would trade the ceiling this
		// avoids for a connection-pool one.
		// biome-ignore lint/performance/noAwaitInLoops: chunks share one connection by design
		await insertChunk(handle, chunk);
	}

	log.debug("cached health points", { count: records.length });
	return records.length;
}

/** Drizzle's `.values()` takes a mutable array, which is what `chunked` hands back. */
async function insertChunk(
	handle: ReturnType<typeof getDb>,
	chunk: HealthCacheRecord[],
): Promise<void> {
	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.insert(sqlitePoints)
				.values(chunk)
				.onConflictDoUpdate({
					set: refreshedColumns(
						sqlitePoints,
						REFRESHED_POINT_COLUMNS,
						excluded,
					),
					target: sqlitePoints.id,
				});
			break;
		case "postgresql":
			await handle.db
				.insert(postgresqlPoints)
				.values(chunk)
				.onConflictDoUpdate({
					set: refreshedColumns(
						postgresqlPoints,
						REFRESHED_POINT_COLUMNS,
						excluded,
					),
					target: postgresqlPoints.id,
				});
			break;
		case "mysql":
			await handle.db
				.insert(mysqlPoints)
				.values(chunk)
				.onDuplicateKeyUpdate({
					set: refreshedColumns(mysqlPoints, REFRESHED_POINT_COLUMNS, incoming),
				});
			break;
	}
}

export interface HealthPointPruneScope {
	userId: string;
	dataType: string;
	fromMs: number;
	toMs: number;
	/** Rows stamped before this — that is, rows this run did not see. */
	syncedBefore: Date;
}

/**
 * Removes points inside a freshly synced window that the run did not see.
 *
 * An upsert-only cache can never drop a point the user deleted in Google,
 * which is a correctness problem and a compliance one. Rather than wrap a
 * window in a transaction — Turso speaks HTTP, which is exactly where not to
 * depend on one — every row a run writes is stamped with the run's start, and
 * this sweep deletes whatever inside the window still carries an older stamp.
 *
 * Crash-safe by omission: a run that dies mid-window simply never prunes, and
 * the next complete run does it instead. Only ever call this once every page
 * of the window has been fetched successfully.
 */
export async function pruneHealthDataPoints(
	scope: HealthPointPruneScope,
): Promise<void> {
	const handle = getDb();

	const where = (table: HealthPointColumns & { syncedAt: Column }): SQL =>
		and(
			eq(table.userId, scope.userId),
			eq(table.dataType, scope.dataType),
			gte(table.observedAtMs, scope.fromMs),
			lt(table.observedAtMs, scope.toMs),
			lt(table.syncedAt, scope.syncedBefore),
		) as SQL;

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.delete(sqlitePoints).where(where(sqlitePoints));
			break;
		case "postgresql":
			await handle.db.delete(postgresqlPoints).where(where(postgresqlPoints));
			break;
		case "mysql":
			await handle.db.delete(mysqlPoints).where(where(mysqlPoints));
			break;
	}
}

/**
 * Reads a window of cached points, oldest first.
 *
 * Selects whole rows rather than a projection. A projection would have to be
 * spelled out once per dialect — Drizzle's table types carry no index
 * signature, so one shared column list cannot be written generically — and
 * three copies of eleven column names is exactly the drift these rules exist
 * to avoid. The extra bookkeeping columns cost a few bytes and are ignored by
 * every caller.
 */
export async function readHealthDataPoints(
	query: HealthPointQuery,
): Promise<StoredHealthPoint[]> {
	const handle = getDb();
	const limit = query.limit ?? DEFAULT_READ_LIMIT;

	switch (handle.dialect) {
		case "sqlite":
			return (await handle.db
				.select()
				.from(sqlitePoints)
				.where(healthPointWindow(sqlitePoints, query))
				.orderBy(sqlitePoints.observedAtMs)
				.limit(limit)) as StoredHealthPoint[];
		case "postgresql":
			return (await handle.db
				.select()
				.from(postgresqlPoints)
				.where(healthPointWindow(postgresqlPoints, query))
				.orderBy(postgresqlPoints.observedAtMs)
				.limit(limit)) as StoredHealthPoint[];
		case "mysql":
			return (await handle.db
				.select()
				.from(mysqlPoints)
				.where(healthPointWindow(mysqlPoints, query))
				.orderBy(mysqlPoints.observedAtMs)
				.limit(limit)) as StoredHealthPoint[];
	}
}

/** Counts cached points for a user, for the dashboard's "what is stored" line. */
export async function countHealthDataPoints(userId: string): Promise<number> {
	const handle = getDb();
	const count = sql<number>`count(*)`;

	const rows = await (async (): Promise<{ count: number }[]> => {
		switch (handle.dialect) {
			case "sqlite":
				return handle.db
					.select({ count })
					.from(sqlitePoints)
					.where(eq(sqlitePoints.userId, userId));
			case "postgresql":
				return handle.db
					.select({ count })
					.from(postgresqlPoints)
					.where(eq(postgresqlPoints.userId, userId));
			case "mysql":
				return handle.db
					.select({ count })
					.from(mysqlPoints)
					.where(eq(mysqlPoints.userId, userId));
		}
	})();

	// PostgreSQL returns count(*) as a bigint, which `pg` hands back as a string.
	return Number(rows[0]?.count ?? 0);
}

/** Deletes every cached point for one user. See `purgeUserHealthCache`. */
export async function deleteHealthDataPoints(userId: string): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.delete(sqlitePoints)
				.where(eq(sqlitePoints.userId, userId));
			break;
		case "postgresql":
			await handle.db
				.delete(postgresqlPoints)
				.where(eq(postgresqlPoints.userId, userId));
			break;
		case "mysql":
			await handle.db.delete(mysqlPoints).where(eq(mysqlPoints.userId, userId));
			break;
	}

	log.info("purged cached health points", { userId });
}
