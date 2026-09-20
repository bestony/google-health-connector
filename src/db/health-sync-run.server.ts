import { randomBytes } from "node:crypto";
import {
	and,
	type Column,
	desc,
	eq,
	isNull,
	lt,
	or,
	type SQL,
} from "drizzle-orm";
import { createLogger } from "../lib/logger.server";
import { getDb } from "./client.server";
import {
	healthSyncLease as mysqlLease,
	healthSyncRun as mysqlRun,
} from "./schema/mysql";
import {
	healthSyncLease as postgresqlLease,
	healthSyncRun as postgresqlRun,
} from "./schema/postgresql";
import {
	healthSyncLease as sqliteLease,
	healthSyncRun as sqliteRun,
} from "./schema/sqlite";

/**
 * The lease that serialises sync invocations, and the log of what they did.
 *
 * Follows the same three dialect rules as `health-cache.server.ts`, and is
 * exercised by `scripts/health-cache-roundtrip.ts` on all three engines.
 */

const log = createLogger("health:sync:lease");

export interface LeaseRow {
	id: string;
	holder: string | null;
	acquiredAt: Date | null;
	expiresAt: Date | null;
	heartbeatAt: Date | null;
	cursorUserId: string | null;
}

export type LeaseResult =
	| { acquired: true; token: string; cursorUserId: string | undefined }
	| { acquired: false; heldUntil: Date | undefined };

async function readLease(id: string): Promise<LeaseRow | undefined> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			return (
				await handle.db
					.select()
					.from(sqliteLease)
					.where(eq(sqliteLease.id, id))
					.limit(1)
			)[0] as LeaseRow | undefined;
		case "postgresql":
			return (
				await handle.db
					.select()
					.from(postgresqlLease)
					.where(eq(postgresqlLease.id, id))
					.limit(1)
			)[0] as LeaseRow | undefined;
		case "mysql":
			return (
				await handle.db
					.select()
					.from(mysqlLease)
					.where(eq(mysqlLease.id, id))
					.limit(1)
			)[0] as LeaseRow | undefined;
	}
}

/**
 * Takes the lease if it is free or expired.
 *
 * One conditional UPDATE, then a read-back. Row-level locking serialises
 * concurrent writers on all three engines and each re-evaluates its WHERE after
 * the lock is released, so the loser's predicate fails against the winner's
 * committed row.
 *
 * The result is decided by comparing the token rather than by an affected-row
 * count: the three drivers report that count three different ways, and MySQL
 * additionally reports zero for an UPDATE that matched but changed nothing. The
 * token is unforgeable, so comparing it is both portable and strictly more
 * precise.
 *
 * A process killed mid-run — which is exactly what a serverless platform does
 * at its timeout — leaves the lease held until it expires, and the next
 * invocation takes it then. No janitor, no cleanup job.
 */
export async function acquireLease(
	id: string,
	ttlMs: number,
	now: Date,
): Promise<LeaseResult> {
	const handle = getDb();
	const token = randomBytes(16).toString("hex");
	const expiresAt = new Date(now.getTime() + ttlMs);
	const held = {
		acquiredAt: now,
		expiresAt,
		heartbeatAt: now,
		holder: token,
		updatedAt: now,
	};

	const free = (table: {
		id: Column;
		holder: Column;
		expiresAt: Column;
	}): SQL =>
		and(
			eq(table.id, id),
			or(isNull(table.holder), lt(table.expiresAt, now)),
		) as SQL;

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.update(sqliteLease).set(held).where(free(sqliteLease));
			break;
		case "postgresql":
			await handle.db
				.update(postgresqlLease)
				.set(held)
				.where(free(postgresqlLease));
			break;
		case "mysql":
			await handle.db.update(mysqlLease).set(held).where(free(mysqlLease));
			break;
	}

	const row = await readLease(id);
	if (row?.holder === token) {
		log.debug("lease acquired", { expiresAt, id });
		return {
			acquired: true,
			cursorUserId: row.cursorUserId ?? undefined,
			token,
		};
	}

	log.warn("lease not acquired", { heldUntil: row?.expiresAt, id });
	return { acquired: false, heldUntil: row?.expiresAt ?? undefined };
}

/**
 * Extends the lease, but only for the holder.
 *
 * Returns whether this caller still holds it. A `false` means the lease expired
 * and someone else took it, and the caller must stop writing rather than carry
 * on as a zombie.
 */
export async function heartbeatLease(
	id: string,
	token: string,
	ttlMs: number,
	now: Date,
): Promise<boolean> {
	const handle = getDb();
	const extended = {
		expiresAt: new Date(now.getTime() + ttlMs),
		heartbeatAt: now,
		updatedAt: now,
	};

	const mine = (table: { id: Column; holder: Column }): SQL =>
		and(eq(table.id, id), eq(table.holder, token)) as SQL;

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.update(sqliteLease)
				.set(extended)
				.where(mine(sqliteLease));
			break;
		case "postgresql":
			await handle.db
				.update(postgresqlLease)
				.set(extended)
				.where(mine(postgresqlLease));
			break;
		case "mysql":
			await handle.db.update(mysqlLease).set(extended).where(mine(mysqlLease));
			break;
	}

	return (await readLease(id))?.holder === token;
}

/**
 * Releases the lease and records where the rotation got to.
 *
 * The `holder = token` guard is the fencing token, and it is the most important
 * line here: a stalled invocation whose lease expired and was taken by someone
 * else cannot come back, release a lease it no longer holds, and overwrite the
 * new holder's cursor with its own stale one.
 */
export async function releaseLease(
	id: string,
	token: string,
	cursorUserId: string | undefined,
	now: Date,
): Promise<void> {
	const handle = getDb();
	const released = {
		cursorUserId: cursorUserId ?? null,
		expiresAt: null,
		holder: null,
		updatedAt: now,
	};

	const mine = (table: { id: Column; holder: Column }): SQL =>
		and(eq(table.id, id), eq(table.holder, token)) as SQL;

	switch (handle.dialect) {
		case "sqlite":
			await handle.db
				.update(sqliteLease)
				.set(released)
				.where(mine(sqliteLease));
			break;
		case "postgresql":
			await handle.db
				.update(postgresqlLease)
				.set(released)
				.where(mine(postgresqlLease));
			break;
		case "mysql":
			await handle.db.update(mysqlLease).set(released).where(mine(mysqlLease));
			break;
	}
}

export interface HealthSyncRunRow {
	id: string;
	startedAt: Date;
	finishedAt: Date | null;
	trigger: string;
	outcome: string | null;
	usersConsidered: number;
	usersTouched: number;
	tasksPlanned: number;
	tasksRan: number;
	pointsInserted: number;
	pointsUpdated: number;
	retries: number;
	blocksWritten: number;
	moreWork: boolean;
	error: string | null;
}

/**
 * Opens a run row before any work happens.
 *
 * Written at the start rather than the end on purpose: a row left with
 * `finished_at` null and an old `started_at` is the signature of an invocation
 * the platform killed, which is otherwise invisible — a killed process writes
 * no log line saying so.
 */
export async function startRun(
	row: Pick<HealthSyncRunRow, "id" | "startedAt" | "trigger">,
): Promise<void> {
	const handle = getDb();
	const values = { ...row };

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.insert(sqliteRun).values(values);
			break;
		case "postgresql":
			await handle.db.insert(postgresqlRun).values(values);
			break;
		case "mysql":
			await handle.db.insert(mysqlRun).values(values);
			break;
	}
}

export type RunPatch = Partial<Omit<HealthSyncRunRow, "id" | "startedAt">>;

export async function finishRun(id: string, patch: RunPatch): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.update(sqliteRun).set(patch).where(eq(sqliteRun.id, id));
			break;
		case "postgresql":
			await handle.db
				.update(postgresqlRun)
				.set(patch)
				.where(eq(postgresqlRun.id, id));
			break;
		case "mysql":
			await handle.db.update(mysqlRun).set(patch).where(eq(mysqlRun.id, id));
			break;
	}
}

/** The most recent runs, newest first — what `GET /api/cron/status` returns. */
export async function listRecentRuns(
	limit: number,
): Promise<HealthSyncRunRow[]> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			return (await handle.db
				.select()
				.from(sqliteRun)
				.orderBy(desc(sqliteRun.startedAt))
				.limit(limit)) as HealthSyncRunRow[];
		case "postgresql":
			return (await handle.db
				.select()
				.from(postgresqlRun)
				.orderBy(desc(postgresqlRun.startedAt))
				.limit(limit)) as HealthSyncRunRow[];
		case "mysql":
			return (await handle.db
				.select()
				.from(mysqlRun)
				.orderBy(desc(mysqlRun.startedAt))
				.limit(limit)) as HealthSyncRunRow[];
	}
}

/**
 * Drops run rows older than the retention window.
 *
 * One bounded DELETE at the end of a run, rather than a second scheduled job
 * whose own failure mode would need watching.
 */
export async function pruneRunLog(before: Date): Promise<void> {
	const handle = getDb();

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.delete(sqliteRun).where(lt(sqliteRun.startedAt, before));
			break;
		case "postgresql":
			await handle.db
				.delete(postgresqlRun)
				.where(lt(postgresqlRun.startedAt, before));
			break;
		case "mysql":
			await handle.db.delete(mysqlRun).where(lt(mysqlRun.startedAt, before));
			break;
	}
}
