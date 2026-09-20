import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getDb, resetDb } from "../src/db/client.server";
import {
	countHealthDataPoints,
	pruneHealthDataPoints,
	readHealthDataPoints,
	upsertHealthDataPoints,
} from "../src/db/health-cache.server";
import {
	acquireLease,
	finishRun,
	heartbeatLease,
	listRecentRuns,
	pruneRunLog,
	releaseLease,
	startRun,
} from "../src/db/health-sync-run.server";
import {
	clearHealthSyncFailures,
	listEnabledHealthSyncAccounts,
	purgeUserHealthCache,
	readHealthSyncAccount,
	readHealthSyncStates,
	upsertHealthSyncAccount,
	upsertHealthSyncState,
} from "../src/db/health-sync-state.server";
import { user as mysqlUser } from "../src/db/schema/mysql";
import { user as postgresqlUser } from "../src/db/schema/postgresql";
import { user as sqliteUser } from "../src/db/schema/sqlite";
import type { DataPoint } from "../src/lib/google-health-api.gen";
import {
	healthSyncStateId,
	toHealthCacheRecord,
} from "../src/lib/google-health-cache-record.server";
import { LEASE_ID } from "../src/lib/health-sync/config";
import { createLogger } from "../src/lib/logger.server";

/**
 * Round-trips every operation in `src/db/health-cache.server.ts` against the
 * database `DATABASE_URL` names.
 *
 * That module is the one place in the app that switches on the dialect, and it
 * is excluded from the unit coverage gate for the same reason `client.server.ts`
 * is: what can go wrong is not the branching but the SQL each branch emits.
 * A unit test with a stubbed handle would assert the switch picked the right
 * table and prove nothing about whether `ON DUPLICATE KEY UPDATE` refreshes the
 * right columns, whether a `bigint` survives a round trip, or whether a JSON
 * column comes back as an object.
 *
 * Being dialect-agnostic is the point: run it three times with `DATABASE_URL`
 * overridden and the three lineages are checked by the same assertions.
 *
 * Migrations must already be applied; `scripts/test-integration.ts` runs
 * `db:migrate` first.
 */

const log = createLogger("health-cache:roundtrip");

const USER = `roundtrip_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const RUN_ONE = new Date("2026-09-20T05:00:00.000Z");
const RUN_TWO = new Date("2026-09-21T05:00:00.000Z");
const RUN_THREE = new Date("2026-09-22T05:00:00.000Z");

/** A day of August 2026, which every window below sits inside. */
const WINDOW = { fromMs: Date.UTC(2026, 7, 9), toMs: Date.UTC(2026, 7, 10) };

function steps(count: string, minute: number): DataPoint {
	const start = new Date(Date.UTC(2026, 7, 9, 0, minute));
	return {
		dataSource: { platform: "FITBIT" },
		steps: {
			count,
			interval: {
				endTime: new Date(start.getTime() + 60_000).toISOString(),
				startTime: start.toISOString(),
			},
		},
	};
}

function records(points: readonly DataPoint[], syncedAt: Date) {
	return points.flatMap((point) => {
		const mapping = toHealthCacheRecord(point, {
			dataType: "steps",
			syncedAt,
			userId: USER,
		});
		return mapping.ok ? [mapping.record] : [];
	});
}

function syncState(dataType: string, overrides: Record<string, unknown> = {}) {
	return {
		backfillComplete: false,
		coveredFromMs: WINDOW.fromMs,
		coveredThroughMs: WINDOW.toMs,
		dataType,
		disabledAt: null,
		failedAt: null,
		failureCode: null,
		failureCount: 0,
		failureMessage: null,
		failureStatus: null,
		id: healthSyncStateId(USER, dataType),
		lastAttemptAt: RUN_TWO,
		lastPointCount: 3,
		lastSyncAt: RUN_TWO,
		retryAfter: null,
		userId: USER,
		...overrides,
	} as Parameters<typeof upsertHealthSyncState>[0];
}

/**
 * Creates the owning `user` row.
 *
 * Not optional: all three engines enforce the `ON DELETE CASCADE` foreign key,
 * libSQL included — it defaults `PRAGMA foreign_keys` to on, which is worth
 * knowing before assuming SQLite will let an orphan through.
 */
async function createOwner(): Promise<() => Promise<void>> {
	const handle = getDb();
	const row = {
		createdAt: RUN_ONE,
		email: `${USER}@example.test`,
		emailVerified: false,
		id: USER,
		name: "Health cache round-trip",
		updatedAt: RUN_ONE,
	};

	switch (handle.dialect) {
		case "sqlite":
			await handle.db.insert(sqliteUser).values(row);
			break;
		case "postgresql":
			await handle.db.insert(postgresqlUser).values(row);
			break;
		case "mysql":
			await handle.db.insert(mysqlUser).values(row);
			break;
	}

	return async () => {
		const live = getDb();
		switch (live.dialect) {
			case "sqlite":
				await live.db.delete(sqliteUser).where(eq(sqliteUser.id, USER));
				break;
			case "postgresql":
				await live.db.delete(postgresqlUser).where(eq(postgresqlUser.id, USER));
				break;
			case "mysql":
				await live.db.delete(mysqlUser).where(eq(mysqlUser.id, USER));
				break;
		}
	};
}

async function checkPoints(): Promise<void> {
	await upsertHealthDataPoints(
		records([steps("100", 0), steps("200", 1), steps("300", 2)], RUN_ONE),
	);
	assert.equal(await countHealthDataPoints(USER), 3, "three points inserted");

	// The daily sync re-reads days it already covered. The same three
	// observations must land on the same three rows, with the corrected value
	// winning — this is the single most important behaviour in the module.
	await upsertHealthDataPoints(
		records([steps("111", 0), steps("200", 1), steps("300", 2)], RUN_TWO),
	);
	assert.equal(
		await countHealthDataPoints(USER),
		3,
		"re-reading a covered day upserts rather than duplicating",
	);

	const read = await readHealthDataPoints({
		dataType: "steps",
		userId: USER,
		...WINDOW,
	});
	assert.equal(read.length, 3, "the window read returns all three");
	assert.equal(read[0]?.value.count, "111", "the corrected measurement won");
	assert.equal(
		typeof read[0]?.observedAtMs,
		"number",
		"a bigint comes back as a number",
	);
	assert.equal(
		read[0]?.observedAtMs,
		Date.UTC(2026, 7, 9),
		"the instant survives the round trip",
	);
	assert.deepEqual(
		read[0]?.observedTime,
		{
			interval: {
				endTime: "2026-08-09T00:01:00.000Z",
				startTime: "2026-08-09T00:00:00.000Z",
			},
		},
		"a JSON column comes back as an object, not a string",
	);
	assert.ok(
		(read[0]?.observedAtMs ?? 0) < (read[1]?.observedAtMs ?? 0),
		"rows come back oldest first",
	);
}

async function checkOverlapAnchor(): Promise<void> {
	const night: DataPoint = {
		name: "users/me/dataTypes/sleep/dataPoints/roundtrip",
		sleep: {
			interval: {
				endTime: "2026-08-09T06:00:00Z",
				startTime: "2026-08-08T22:00:00Z",
			},
			type: "STAGES",
		},
	};
	const mapping = toHealthCacheRecord(night, {
		dataType: "sleep",
		syncedAt: RUN_TWO,
		userId: USER,
	});
	assert.ok(mapping.ok, "the sleep session maps to a record");
	await upsertHealthDataPoints([mapping.record]);

	const byStart = await readHealthDataPoints({
		dataType: "sleep",
		userId: USER,
		...WINDOW,
	});
	assert.equal(byStart.length, 0, "the start anchor misses a night before");

	const byOverlap = await readHealthDataPoints({
		anchor: "overlap",
		dataType: "sleep",
		userId: USER,
		...WINDOW,
	});
	assert.equal(byOverlap.length, 1, "the overlap anchor finds that night");
}

async function checkPrune(): Promise<void> {
	// Only one of the three points is re-stamped by the third run.
	await upsertHealthDataPoints(records([steps("111", 0)], RUN_THREE));
	await pruneHealthDataPoints({
		dataType: "steps",
		syncedBefore: RUN_THREE,
		userId: USER,
		...WINDOW,
	});
	assert.equal(
		(await readHealthDataPoints({ dataType: "steps", userId: USER, ...WINDOW }))
			.length,
		1,
		"the sweep removes exactly the rows the run did not touch",
	);
}

async function checkSyncState(): Promise<void> {
	await upsertHealthSyncState(syncState("steps"));
	await upsertHealthSyncState(
		syncState("sleep", {
			coveredFromMs: null,
			coveredThroughMs: null,
			disabledAt: RUN_TWO,
			failedAt: RUN_TWO,
			failureCode: "PERMISSION_DENIED",
			failureCount: 1,
			failureMessage: "The caller does not have permission",
			failureStatus: 403,
			lastPointCount: 0,
			lastSyncAt: null,
			retryAfter: new Date("2026-09-28T05:00:00.000Z"),
		}),
	);

	let states = await readHealthSyncStates(USER);
	assert.equal(states.length, 2, "both pairs come back in one query");

	const stepsState = states.find((row) => row.dataType === "steps");
	assert.equal(stepsState?.coveredThroughMs, WINDOW.toMs, "watermark survives");
	assert.equal(
		stepsState?.lastSyncAt?.getTime(),
		RUN_TWO.getTime(),
		"a timestamp keeps millisecond precision",
	);
	assert.equal(
		stepsState?.backfillComplete,
		false,
		"a boolean stays a boolean",
	);
	assert.equal(stepsState?.failureStatus, null, "a null integer stays null");

	assert.ok(stepsState, "the steps state exists");
	await upsertHealthSyncState({
		...stepsState,
		coveredFromMs: WINDOW.fromMs - 86_400_000,
	});
	states = await readHealthSyncStates(USER);
	assert.equal(states.length, 2, "the state upsert did not duplicate");
	assert.equal(
		states.find((row) => row.dataType === "steps")?.coveredFromMs,
		WINDOW.fromMs - 86_400_000,
		"the state upsert moved the watermark",
	);

	await clearHealthSyncFailures(USER);
	states = await readHealthSyncStates(USER);
	const sleepState = states.find((row) => row.dataType === "sleep");
	assert.equal(sleepState?.disabledAt, null, "the block was cleared");
	assert.equal(sleepState?.failureCount, 0, "the failure count was reset");
	assert.equal(
		states.find((row) => row.dataType === "steps")?.coveredThroughMs,
		WINDOW.toMs,
		"clearing failures left the watermarks alone",
	);
}

async function checkAccount(): Promise<void> {
	await upsertHealthSyncAccount({
		disabledAt: null,
		enabled: true,
		enabledAt: RUN_ONE,
		lastProbedAt: null,
		membershipStartDateMs: Date.UTC(2024, 0, 1),
		timeZone: "Asia/Shanghai",
		timeZoneSource: "settings",
		userId: USER,
	});

	const account = await readHealthSyncAccount(USER);
	assert.equal(account?.enabled, true, "the opt-in reads back");
	assert.equal(account?.timeZone, "Asia/Shanghai", "the timezone reads back");
	assert.equal(
		account?.membershipStartDateMs,
		Date.UTC(2024, 0, 1),
		"the membership start date reads back",
	);
	assert.ok(
		(await listEnabledHealthSyncAccounts(100)).some(
			(row) => row.userId === USER,
		),
		"an enabled account is listed for the planner",
	);

	await upsertHealthSyncAccount({
		disabledAt: RUN_TWO,
		enabled: false,
		enabledAt: RUN_ONE,
		lastProbedAt: RUN_TWO,
		membershipStartDateMs: Date.UTC(2024, 0, 1),
		timeZone: "Asia/Shanghai",
		timeZoneSource: "settings",
		userId: USER,
	});
	assert.equal(
		(await readHealthSyncAccount(USER))?.enabled,
		false,
		"the opt-in can be turned back off",
	);
	assert.ok(
		!(await listEnabledHealthSyncAccounts(100)).some(
			(row) => row.userId === USER,
		),
		"a disabled account drops out of the planner's list",
	);
}

async function checkPurge(): Promise<void> {
	await upsertHealthDataPoints(records([steps("1", 5)], RUN_THREE));
	await purgeUserHealthCache(USER);

	assert.equal(await countHealthDataPoints(USER), 0, "every point is gone");
	assert.equal(
		(await readHealthSyncStates(USER)).length,
		0,
		"every watermark is gone",
	);
	assert.ok(
		await readHealthSyncAccount(USER),
		"the account row survives, so its caller decides whether to keep it",
	);
}

/**
 * The lease's concurrency guarantee, which is the one thing here that a unit
 * test genuinely cannot check: it depends on each engine's row locking and on
 * how its driver reports an UPDATE that matched nothing.
 */
async function checkLease(): Promise<void> {
	const id = `roundtrip_${Date.now()}`;
	const now = new Date();

	// Nothing to take: acquire only ever updates a row the migration seeded.
	const missing = await acquireLease(id, 30_000, now);
	assert.equal(missing.acquired, false, "a lease with no row cannot be taken");

	const first = await acquireLease(LEASE_ID, 30_000, now);
	assert.ok(first.acquired, "the seeded lease can be taken");
	if (!first.acquired) return;

	const second = await acquireLease(LEASE_ID, 30_000, now);
	assert.equal(second.acquired, false, "a held lease cannot be taken twice");
	assert.ok(second.heldUntil, "the loser is told when it may retry");

	assert.equal(
		await heartbeatLease(LEASE_ID, first.token, 30_000, now),
		true,
		"the holder can extend its own lease",
	);
	assert.equal(
		await heartbeatLease(LEASE_ID, "not-the-holder", 30_000, now),
		false,
		"a stale invocation cannot extend a lease it no longer holds",
	);

	// The fencing token: a zombie release must not clear the real holder or
	// overwrite its cursor.
	await releaseLease(LEASE_ID, "not-the-holder", "wrong-user", now);
	assert.equal(
		await heartbeatLease(LEASE_ID, first.token, 30_000, now),
		true,
		"a zombie release left the real holder in place",
	);

	await releaseLease(LEASE_ID, first.token, USER, now);
	const third = await acquireLease(LEASE_ID, 30_000, now);
	assert.ok(third.acquired, "a released lease can be taken again");
	assert.equal(
		third.cursorUserId,
		USER,
		"the rotation cursor survives release and re-acquire",
	);

	// An expired lease is takeable without anyone cleaning it up.
	const later = new Date(now.getTime() + 60_000);
	const fourth = await acquireLease(LEASE_ID, 30_000, later);
	assert.ok(fourth.acquired, "an expired lease is taken by the next caller");
	if (fourth.acquired) {
		await releaseLease(LEASE_ID, fourth.token, undefined, later);
	}
}

async function checkRunLog(): Promise<void> {
	const runId = `rt_${Date.now()}`;
	const startedAt = new Date();

	await startRun({ id: runId, startedAt, trigger: "manual" });
	const opened = (await listRecentRuns(5)).find((row) => row.id === runId);
	assert.ok(opened, "the run row is written before any work happens");
	assert.equal(
		opened?.finishedAt,
		null,
		"an open run has no finish time — the signature of a killed invocation",
	);

	const finishedAt = new Date(startedAt.getTime() + 1_000);
	await finishRun(runId, {
		finishedAt,
		moreWork: true,
		outcome: "partial",
		pointsInserted: 7,
		tasksRan: 2,
	});
	const closed = (await listRecentRuns(5)).find((row) => row.id === runId);
	assert.equal(closed?.outcome, "partial", "the outcome is patched in");
	assert.equal(closed?.pointsInserted, 7, "counters are patched in");
	assert.equal(closed?.moreWork, true, "a boolean survives the patch");

	await pruneRunLog(new Date(startedAt.getTime() + 60_000));
	assert.ok(
		!(await listRecentRuns(50)).some((row) => row.id === runId),
		"the retention sweep removes old runs",
	);
}

async function main(): Promise<void> {
	const handle = getDb();
	log.info("round-trip started", { dialect: handle.dialect, userId: USER });

	const removeOwner = await createOwner();
	try {
		await checkPoints();
		await checkOverlapAnchor();
		await checkPrune();
		await checkSyncState();
		await checkAccount();
		await checkPurge();
		await checkLease();
		await checkRunLog();
	} finally {
		// Cascades the account row away with it, which is also worth exercising.
		await removeOwner();
	}

	log.info("round-trip passed", { dialect: handle.dialect });
}

main()
	.then(async () => {
		await resetDb();
	})
	.catch(async (error: unknown) => {
		log.error("round-trip failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		console.error(error);
		await resetDb();
		process.exitCode = 1;
	});
