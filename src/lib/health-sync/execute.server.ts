import {
	pruneHealthDataPoints,
	upsertHealthDataPoints,
} from "../../db/health-cache.server";
import {
	type HealthSyncStateRow,
	readHealthSyncStates,
	upsertHealthSyncState,
} from "../../db/health-sync-state.server";
import type { DataPoint } from "../google-health-api.gen";
import { createGoogleHealthClient } from "../google-health-api.server";
import {
	healthSyncStateId,
	toHealthCacheRecord,
} from "../google-health-cache-record.server";
import {
	isBackfillComplete,
	mergeCoverage,
} from "../google-health-sync-window";
import { createLogger } from "../logger.server";
import { CONCURRENCY, MAX_ATTEMPTS, MAX_POINTS_PER_USER_RUN } from "./config";
import { planTimeWindow, withinPlannedWindow } from "./data-window";
import {
	type ClassifiedFailure,
	classifyFailure,
	restAfterFailure,
	retryDelayFor,
} from "./failure";
import type { SyncTask } from "./plan";
import type { RunCounters } from "./report";

/**
 * Running a plan: the only module that talks to Google and writes what comes
 * back.
 *
 * Five things here are load-bearing and easy to undo by accident.
 *
 * **One client per user per invocation.** The API client memoises its access
 * token, so reusing it across a user's forty data types collapses forty token
 * resolutions into one. `google-health-api.server.ts` forbids reuse across
 * *requests*, not within one; never hoist a client to module scope.
 *
 * **`createGoogleHealthClient({ userId })`, never with headers.** There is a
 * load-bearing comment in `google-health-token.server.ts` about this: passing
 * headers *and* a `userId` makes better-auth resolve the caller's session, and
 * the caller here is a scheduler with no session. It would fail for exactly the
 * callers `userId` exists for.
 *
 * **Concurrency is the throttle.** Nothing else in this app limits outbound
 * calls to Google — no retry loop, no token bucket — so `CONCURRENCY` is the
 * difference between a polite client and a self-inflicted 429.
 *
 * **Checkpoint only at chunk boundaries.** Page order inside a window is not
 * guaranteed monotonic, so writing a watermark mid-chunk would claim coverage
 * that does not exist. An abandoned chunk costs a repeat of at most fourteen
 * days; a lying watermark costs a hole nothing will ever notice.
 *
 * **Prune only after every page arrived.** The sweep deletes rows the run did
 * not restamp, so running it on a partial window deletes real data.
 */

const log = createLogger("health:sync:task");

export interface ExecuteContext {
	now: Date;
	/** Oldest instant the backfill may reach, by user id. */
	floorMsByUser: ReadonlyMap<string, number>;
	/** Wall-clock instant past which no new task starts. */
	deadlineMs: number;
	/** The most wall clock any single user may consume. */
	maxMsPerUser: number;
	counters: RunCounters;
	/** Called between users; `false` means the lease was lost and work must stop. */
	stillLeased: () => Promise<boolean>;
}

export interface ExecuteResult {
	/** Tasks left unrun because the budget or the lease ran out. */
	remaining: number;
	/** The last user whose tasks were attempted, for the rotation cursor. */
	lastUserId: string | undefined;
	lostLease: boolean;
}

function groupByUser(tasks: readonly SyncTask[]): Map<string, SyncTask[]> {
	const groups = new Map<string, SyncTask[]>();
	for (const task of tasks) {
		const existing = groups.get(task.userId);
		if (existing === undefined) groups.set(task.userId, [task]);
		else existing.push(task);
	}
	return groups;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `tasks`, grouped by user, until the budget or the lease runs out.
 *
 * Returns rather than throws on a per-user failure: one user whose Google
 * authorization lapsed must not stop the rest of the rotation.
 */
export async function executePlan(
	tasks: readonly SyncTask[],
	context: ExecuteContext,
): Promise<ExecuteResult> {
	const groups = [...groupByUser(tasks).entries()];
	let done = 0;
	let lastUserId: string | undefined;

	for (const [userId, userTasks] of groups) {
		// Users are processed one at a time on purpose: concurrency is applied
		// within a user, where one client and one token serve every request, and
		// fanning out across users would multiply the outbound rate by the number
		// of users rather than by CONCURRENCY.
		// biome-ignore lint/performance/noAwaitInLoops: the rotation is deliberately serial
		if (!(await context.stillLeased())) {
			return { lastUserId, lostLease: true, remaining: tasks.length - done };
		}
		if (Date.now() >= context.deadlineMs) break;

		lastUserId = userId;
		context.counters.usersTouched += 1;
		done += await runUser(userId, userTasks, context);
	}

	return { lastUserId, lostLease: false, remaining: tasks.length - done };
}

/** Everything one user's turn needs, so the task functions take one argument. */
interface UserRun {
	client: ReturnType<typeof createGoogleHealthClient>;
	states: Map<string, HealthSyncStateRow>;
	context: ExecuteContext;
	floorMs: number;
}

async function runUser(
	userId: string,
	tasks: readonly SyncTask[],
	context: ExecuteContext,
): Promise<number> {
	// One client for this user's whole turn: the token is resolved once.
	const run: UserRun = {
		client: createGoogleHealthClient({ userId }),
		context,
		floorMs: context.floorMsByUser.get(userId) ?? 0,
		states: new Map(
			(await readHealthSyncStates(userId)).map((row) => [row.dataType, row]),
		),
	};
	const userDeadlineMs = Math.min(
		context.deadlineMs,
		Date.now() + context.maxMsPerUser,
	);

	const queue = [...tasks];
	let completed = 0;
	let points = 0;
	let aborted = false;

	const worker = async (): Promise<void> => {
		for (;;) {
			if (aborted || Date.now() >= userDeadlineMs) return;
			if (points >= MAX_POINTS_PER_USER_RUN) return;
			const task = queue.shift();
			if (task === undefined) return;

			// Sequential by design: this worker pulls the next task only once the
			// previous one is done, which is what bounds concurrency to the pool
			// size rather than to the queue length.
			// biome-ignore lint/performance/noAwaitInLoops: the loop is the concurrency limit
			const outcome = await runTask(run, task);
			completed += 1;
			points += outcome.points;
			if (outcome.abortUser) {
				aborted = true;
				return;
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
	);

	return completed;
}

interface TaskOutcome {
	points: number;
	abortUser: boolean;
}

async function runTask(run: UserRun, task: SyncTask): Promise<TaskOutcome> {
	const { context } = run;
	const request = planTimeWindow(task.dataTypeId, task.window);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		try {
			// Attempts are a retry chain: each one only happens because the
			// previous one failed, so there is nothing here to run in parallel.
			// biome-ignore lint/performance/noAwaitInLoops: retries are inherently sequential
			const raw = await run.client.collectDataPoints(task.dataTypeId, {
				from: request.from,
				to: request.to,
			});
			const stored = await storeWindow(task, raw, request, context);
			// Only once every page is written does the watermark move: a
			// checkpoint ahead of the data claims coverage that is not there.
			await checkpointTask(run, task, stored, context.now);
			context.counters.tasksRan += 1;
			return { abortUser: false, points: stored };
		} catch (error) {
			const failure = classifyFailure(error);
			const lastAttempt =
				attempt >= MAX_ATTEMPTS || failure.kind !== "retryable";

			if (!lastAttempt) {
				const delay = retryDelayFor(failure, attempt, error);
				context.counters.retries += 1;
				// Never sleep past the deadline: a delay the invocation cannot
				// afford is a task better left to the next one.
				if (Date.now() + delay >= context.deadlineMs) {
					return { abortUser: failure.abortUser, points: 0 };
				}
				await sleep(delay);
				continue;
			}

			await recordFailure(run, task, failure);
			return { abortUser: failure.abortUser, points: 0 };
		}
	}

	return { abortUser: false, points: 0 };
}

/**
 * Writes a successfully fetched window, then moves the watermark.
 *
 * In this order for a reason: a checkpoint written before the points would
 * claim coverage for data that is not there if the process died in between.
 */
async function storeWindow(
	task: SyncTask,
	raw: readonly DataPoint[],
	request: ReturnType<typeof planTimeWindow>,
	context: ExecuteContext,
): Promise<number> {
	const mapped = raw.flatMap((point) => {
		const mapping = toHealthCacheRecord(point, {
			dataType: task.dataTypeId,
			syncedAt: context.now,
			userId: task.userId,
		});
		return mapping.ok ? [mapping.record] : [];
	});
	const records = withinPlannedWindow(mapped, request);

	if (records.length !== raw.length) {
		log.debug("dropped points outside the window or without a usable time", {
			dataType: task.dataTypeId,
			fetched: raw.length,
			kept: records.length,
		});
	}

	await upsertHealthDataPoints(records);
	context.counters.pointsInserted += records.length;

	// Only now that every page landed: the sweep removes what this run did not
	// restamp, so a partial window would delete real data.
	await pruneHealthDataPoints({
		dataType: task.dataTypeId,
		fromMs: task.window.fromMs,
		syncedBefore: context.now,
		toMs: task.window.throughMs,
		userId: task.userId,
	});

	return records.length;
}

/** Applies a task's result to `health_sync_state`, coverage included. */
export async function checkpointTask(
	run: Pick<UserRun, "states" | "floorMs">,
	task: SyncTask,
	pointCount: number,
	now: Date,
): Promise<void> {
	const { floorMs, states } = run;
	const existing = states.get(task.dataTypeId);
	const merged = mergeCoverage(
		{
			fromMs: existing?.coveredFromMs ?? null,
			throughMs: existing?.coveredThroughMs ?? null,
		},
		task.window,
	);

	if (!merged.ok) {
		// The planner only ever asks for windows adjacent to the watermark, so
		// this means the two disagree. Recording it would be recording a hole.
		log.error("refused a window that would leave a gap in coverage", {
			dataType: task.dataTypeId,
			reason: merged.reason,
			userId: task.userId,
		});
		return;
	}

	const row: HealthSyncStateRow = {
		backfillComplete: isBackfillComplete(merged.coverage, floorMs),
		coveredFromMs: merged.coverage.fromMs,
		coveredThroughMs: merged.coverage.throughMs,
		dataType: task.dataTypeId,
		disabledAt: null,
		failedAt: null,
		failureCode: null,
		failureCount: 0,
		failureMessage: null,
		failureStatus: null,
		id: healthSyncStateId(task.userId, task.dataTypeId),
		lastAttemptAt: now,
		lastPointCount: pointCount,
		lastSyncAt: now,
		retryAfter: null,
		userId: task.userId,
	};

	states.set(task.dataTypeId, row);
	await upsertHealthSyncState(row);
}

/** Records a failure against the pair, resting it for as long as its kind earns. */
async function recordFailure(
	run: UserRun,
	task: SyncTask,
	failure: ClassifiedFailure,
): Promise<void> {
	const { context, states } = run;
	const existing = states.get(task.dataTypeId);
	const failureCount = (existing?.failureCount ?? 0) + 1;
	const rest = restAfterFailure(failure, context.now);

	const row: HealthSyncStateRow = {
		backfillComplete: existing?.backfillComplete ?? false,
		coveredFromMs: existing?.coveredFromMs ?? null,
		coveredThroughMs: existing?.coveredThroughMs ?? null,
		dataType: task.dataTypeId,
		disabledAt: rest.disabledAt,
		failedAt: context.now,
		failureCode: failure.code ?? failure.kind,
		failureCount,
		failureMessage: failure.message.slice(0, 500),
		failureStatus: failure.status ?? null,
		id: healthSyncStateId(task.userId, task.dataTypeId),
		lastAttemptAt: context.now,
		lastPointCount: existing?.lastPointCount ?? 0,
		lastSyncAt: existing?.lastSyncAt ?? null,
		retryAfter: rest.retryAfter,
		userId: task.userId,
	};

	states.set(task.dataTypeId, row);
	context.counters.blocksWritten += 1;
	await upsertHealthSyncState(row);

	log.warn("sync failed for a data type", {
		dataType: task.dataTypeId,
		failureCount,
		kind: failure.kind,
		retryAfter: rest.retryAfter,
		status: failure.status,
		userId: task.userId,
	});
}
