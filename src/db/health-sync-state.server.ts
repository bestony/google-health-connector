import { and, type Column, eq, isNotNull, type SQL } from "drizzle-orm";
import { createLogger } from "../lib/logger.server";
import { getDb } from "./client.server";
import { deleteHealthDataPoints } from "./health-cache.server";
import {
	healthSyncAccount as mysqlAccounts,
	healthSyncState as mysqlStates,
} from "./schema/mysql";
import {
	healthSyncAccount as postgresqlAccounts,
	healthSyncState as postgresqlStates,
} from "./schema/postgresql";
import {
	healthSyncAccount as sqliteAccounts,
	healthSyncState as sqliteStates,
} from "./schema/sqlite";
import { excluded, incoming, refreshedColumns } from "./upsert.server";

/**
 * The sync's own bookkeeping: what has been fetched per (user, data type), and
 * which users asked for any of it.
 *
 * Follows the same three rules as `health-cache.server.ts`, and is exercised by
 * the same `scripts/health-cache-roundtrip.ts` against all three dialects.
 */

const log = createLogger("db");

/** One row of `health_sync_state`, as the planner and the dashboard read it. */
export interface HealthSyncStateRow {
	id: string;
	userId: string;
	dataType: string;
	coveredFromMs: number | null;
	coveredThroughMs: number | null;
	backfillComplete: boolean;
	lastSyncAt: Date | null;
	lastAttemptAt: Date | null;
	lastPointCount: number;
	failureStatus: number | null;
	failureCode: string | null;
	failureMessage: string | null;
	failureCount: number;
	failedAt: Date | null;
	disabledAt: Date | null;
	retryAfter: Date | null;
}

/** One row of `health_sync_account`. */
export interface HealthSyncAccountRow {
	userId: string;
	enabled: boolean;
	enabledAt: Date | null;
	disabledAt: Date | null;
	timeZone: string | null;
	timeZoneSource: string | null;
	membershipStartDateMs: number | null;
	lastProbedAt: Date | null;
}

const REFRESHED_STATE_COLUMNS = [
	"coveredFromMs",
	"coveredThroughMs",
	"backfillComplete",
	"lastSyncAt",
	"lastAttemptAt",
	"lastPointCount",
	"failureStatus",
	"failureCode",
	"failureMessage",
	"failureCount",
	"failedAt",
	"disabledAt",
	"retryAfter",
] as const;

const REFRESHED_ACCOUNT_COLUMNS = [
	"enabled",
	"enabledAt",
	"disabledAt",
	"timeZone",
	"timeZoneSource",
	"membershipStartDateMs",
	"lastProbedAt",
] as const;

/**
 * Every sync state row for one user, in a single query.
 *
 * Read per user rather than per pair: a planner slice covering twenty-five
 * users and forty data types would otherwise open with a thousand round trips
 * before doing any work.
 */
export async function readHealthSyncStates(
	userId: string,
): Promise<HealthSyncStateRow[]> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			return (await handle.db
				.select()
				.from(sqliteStates)
				.where(eq(sqliteStates.userId, userId))) as HealthSyncStateRow[];
		case "postgresql":
			return (await handle.db
				.select()
				.from(postgresqlStates)
				.where(eq(postgresqlStates.userId, userId))) as HealthSyncStateRow[];
		case "mysql":
			return (await handle.db
				.select()
				.from(mysqlStates)
				.where(eq(mysqlStates.userId, userId))) as HealthSyncStateRow[];
	}
}

/**
 * Writes the sync state for one pair.
 *
 * The caller supplies the whole row rather than a patch, and its `id` is a
 * digest of (user, data type), so this never needs a prior read — which is
 * what lets the executor checkpoint at a chunk boundary in one round trip.
 */
export async function upsertHealthSyncState(
	row: HealthSyncStateRow,
): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.insert(sqliteStates)
				.values(row)
				.onConflictDoUpdate({
					set: refreshedColumns(
						sqliteStates,
						REFRESHED_STATE_COLUMNS,
						excluded,
					),
					target: sqliteStates.id,
				});
			break;
		case "postgresql":
			await handle.db
				.insert(postgresqlStates)
				.values(row)
				.onConflictDoUpdate({
					set: refreshedColumns(
						postgresqlStates,
						REFRESHED_STATE_COLUMNS,
						excluded,
					),
					target: postgresqlStates.id,
				});
			break;
		case "mysql":
			await handle.db
				.insert(mysqlStates)
				.values(row)
				.onDuplicateKeyUpdate({
					set: refreshedColumns(mysqlStates, REFRESHED_STATE_COLUMNS, incoming),
				});
			break;
	}
}

/**
 * Puts every disabled pair for a user back in the rotation.
 *
 * Wired to a fresh Google authorization and to a button on the dashboard: new
 * scopes are exactly what makes a stored 403 stale, and making a user who just
 * granted a category wait out the scheduled re-probe would look like the grant
 * had not worked.
 *
 * Clears the failure columns only. The watermarks stay, because the coverage
 * that was already fetched is still fetched.
 */
export async function clearHealthSyncFailures(userId: string): Promise<void> {
	const handle = getDb();
	const cleared = {
		disabledAt: null,
		failedAt: null,
		failureCode: null,
		failureCount: 0,
		failureMessage: null,
		failureStatus: null,
		retryAfter: null,
	};

	const where = (table: { userId: Column; disabledAt: Column }): SQL =>
		and(eq(table.userId, userId), isNotNull(table.disabledAt)) as SQL;

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.update(sqliteStates)
				.set(cleared)
				.where(where(sqliteStates));
			break;
		case "postgresql":
			await handle.db
				.update(postgresqlStates)
				.set(cleared)
				.where(where(postgresqlStates));
			break;
		case "mysql":
			await handle.db
				.update(mysqlStates)
				.set(cleared)
				.where(where(mysqlStates));
			break;
	}
}

export async function readHealthSyncAccount(
	userId: string,
): Promise<HealthSyncAccountRow | undefined> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			return (
				await handle.db
					.select()
					.from(sqliteAccounts)
					.where(eq(sqliteAccounts.userId, userId))
					.limit(1)
			)[0] as HealthSyncAccountRow | undefined;
		case "postgresql":
			return (
				await handle.db
					.select()
					.from(postgresqlAccounts)
					.where(eq(postgresqlAccounts.userId, userId))
					.limit(1)
			)[0] as HealthSyncAccountRow | undefined;
		case "mysql":
			return (
				await handle.db
					.select()
					.from(mysqlAccounts)
					.where(eq(mysqlAccounts.userId, userId))
					.limit(1)
			)[0] as HealthSyncAccountRow | undefined;
	}
}

export async function upsertHealthSyncAccount(
	row: HealthSyncAccountRow,
): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.insert(sqliteAccounts)
				.values(row)
				.onConflictDoUpdate({
					set: refreshedColumns(
						sqliteAccounts,
						REFRESHED_ACCOUNT_COLUMNS,
						excluded,
					),
					target: sqliteAccounts.userId,
				});
			break;
		case "postgresql":
			await handle.db
				.insert(postgresqlAccounts)
				.values(row)
				.onConflictDoUpdate({
					set: refreshedColumns(
						postgresqlAccounts,
						REFRESHED_ACCOUNT_COLUMNS,
						excluded,
					),
					target: postgresqlAccounts.userId,
				});
			break;
		case "mysql":
			await handle.db
				.insert(mysqlAccounts)
				.values(row)
				.onDuplicateKeyUpdate({
					set: refreshedColumns(
						mysqlAccounts,
						REFRESHED_ACCOUNT_COLUMNS,
						incoming,
					),
				});
			break;
	}
}

/**
 * Every user who has opted in, in a stable order.
 *
 * The planner pages through this with a rotation cursor; ordering by the
 * primary key is what makes that rotation stable across invocations.
 */
export async function listEnabledHealthSyncAccounts(
	limit: number,
): Promise<HealthSyncAccountRow[]> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			return (await handle.db
				.select()
				.from(sqliteAccounts)
				.where(eq(sqliteAccounts.enabled, true))
				.orderBy(sqliteAccounts.userId)
				.limit(limit)) as HealthSyncAccountRow[];
		case "postgresql":
			return (await handle.db
				.select()
				.from(postgresqlAccounts)
				.where(eq(postgresqlAccounts.enabled, true))
				.orderBy(postgresqlAccounts.userId)
				.limit(limit)) as HealthSyncAccountRow[];
		case "mysql":
			return (await handle.db
				.select()
				.from(mysqlAccounts)
				.where(eq(mysqlAccounts.enabled, true))
				.orderBy(mysqlAccounts.userId)
				.limit(limit)) as HealthSyncAccountRow[];
	}
}

/** Deletes every sync watermark for one user. See `purgeUserHealthCache`. */
async function deleteHealthSyncStates(userId: string): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.delete(sqliteStates)
				.where(eq(sqliteStates.userId, userId));
			break;
		case "postgresql":
			await handle.db
				.delete(postgresqlStates)
				.where(eq(postgresqlStates.userId, userId));
			break;
		case "mysql":
			await handle.db.delete(mysqlStates).where(eq(mysqlStates.userId, userId));
			break;
	}
}

/**
 * Deletes every cached point and every sync watermark for one user.
 *
 * Called when the user opts out, when Google access is unlinked or revoked,
 * and when the account is deleted. The `ON DELETE CASCADE` on both tables
 * covers only the last of those — and all three engines do enforce it, libSQL
 * included, which defaults `PRAGMA foreign_keys` to on. Opting out and revoking
 * Google both leave the `user` row exactly where it is, so nothing cascades and
 * this is the only thing that removes the copy. The privacy policy says turning
 * the switch off deletes what was cached; this function is what makes that
 * true.
 *
 * A *partial* scope reduction purges everything for the user and lets the sync
 * rebuild what is still permitted. Google publishes no mapping from the forty
 * data types onto its twelve consent categories, so a selective purge would be
 * guesswork — and guessing wrong leaves revoked health data on disk.
 *
 * `health_sync_account` is left alone on purpose: it holds the opt-in flag
 * itself, and its caller decides whether the user is opting out or the row is
 * going away with the account.
 */
export async function purgeUserHealthCache(userId: string): Promise<void> {
	await deleteHealthDataPoints(userId);
	await deleteHealthSyncStates(userId);
	log.info("purged health cache", { userId });
}

/**
 * Whether a pair is live — never disabled, or disabled but due for a re-probe.
 *
 * The re-probe is what lets a category granted after the fact start syncing
 * without an operator touching anything.
 */
export function isSyncStateActive(row: HealthSyncStateRow, now: Date): boolean {
	if (row.disabledAt === null) return true;
	return row.retryAfter !== null && row.retryAfter.getTime() <= now.getTime();
}
