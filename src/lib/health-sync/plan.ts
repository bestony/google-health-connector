import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import {
	nextBackfillWindow,
	nextForwardWindow,
	type SyncCoverage,
	type SyncWindow,
} from "../google-health-sync-window";
import {
	BACKFILL_CHUNK_DAYS,
	BUDGET_RESERVE_MS,
	DAY_MS,
	ESTIMATED_TASK_MS,
	FORWARD_CHUNK_DAYS,
} from "./config";
import { dailyTargetWindow } from "./time-window";

/**
 * What one invocation should do, decided without touching anything.
 *
 * There is no job queue table, and that is the load-bearing decision of the
 * whole feature. The work owed is *derived* from sync state on every
 * invocation: a watermark behind the daily window means daily work is owed, a
 * lower watermark above the history floor means backfill is owed, and a
 * disabled pair means nothing is owed. A queue would be a second source of
 * truth that can disagree with the data it describes, and would need its own
 * reconciliation; deriving instead makes the planner crash-safe, idempotent and
 * free of orphaned jobs, and makes "resumable across invocations" fall out
 * rather than be built.
 *
 * It is also why this module is pure. The scheduling rules — daily before
 * backfill, rotation, budget — are the part that has to be *right*, and here
 * they are decided by a function with no I/O, so each of them is a unit test.
 */

export type SyncTaskKind = "daily" | "backfill";

export interface SyncTask {
	userId: string;
	dataTypeId: GoogleHealthDataTypeId;
	kind: SyncTaskKind;
	/** The window to fetch, already resolved through the user's timezone. */
	window: SyncWindow;
	/** A coarse cost hint, used only for budget arithmetic before any work runs. */
	estimatedMs: number;
}

/** What the planner needs to know about one user. */
export interface PlannedUser {
	userId: string;
	/** IANA zone, or a fixed-offset fallback. Never empty. */
	timeZone: string;
	/** From `Profile.membershipStartDate`, when it is known. */
	membershipStartMs: number | undefined;
	dataTypes: readonly GoogleHealthDataTypeId[];
	/** Keyed by data type. Missing means never synced. */
	coverage: ReadonlyMap<string, SyncCoverage>;
	/** Data types currently out of the rotation, by data type id. */
	blocked: ReadonlySet<string>;
}

export interface PlanInput {
	now: Date;
	budgetMs: number;
	/** The rotation resumes after this user. */
	cursorUserId: string | undefined;
	users: readonly PlannedUser[];
	/** How far back the backfill may reach, in days. */
	backfillDays: number;
}

export interface SyncPlan {
	tasks: SyncTask[];
	/** Debt this budget could not cover. Drives the response's `moreWork`. */
	truncated: boolean;
	/** Where the next invocation resumes the rotation. */
	nextCursorUserId: string | undefined;
	skipped: {
		blocked: number;
		upToDate: number;
		backfillComplete: number;
	};
}

/**
 * Rotates a stable list so it resumes after `cursorUserId`.
 *
 * The rotation is what keeps a user with three years of history from
 * monopolising consecutive invocations. A cursor naming a user who is no longer
 * in the list — they opted out, or fell outside this slice — starts from the
 * beginning, which costs one repeated visit and never stalls.
 */
export function rotateAfter<T extends { userId: string }>(
	users: readonly T[],
	cursorUserId: string | undefined,
): T[] {
	if (cursorUserId === undefined || users.length === 0) return [...users];
	const index = users.findIndex((user) => user.userId === cursorUserId);
	if (index < 0) return [...users];
	return [...users.slice(index + 1), ...users.slice(0, index + 1)];
}

/** The oldest instant the backfill may reach for this user. */
export function backfillFloorMs(user: PlannedUser, input: PlanInput): number {
	const configured = input.now.getTime() - input.backfillDays * DAY_MS;
	// A membership start date is a real floor: there is nothing before it to
	// fetch, so honouring it is what lets a backfill actually finish rather than
	// grind against an empty range until the configured window moves.
	return user.membershipStartMs === undefined
		? configured
		: Math.max(configured, user.membershipStartMs);
}

function coverageFor(user: PlannedUser, dataType: string): SyncCoverage {
	return user.coverage.get(dataType) ?? { fromMs: null, throughMs: null };
}

/**
 * Plans one invocation.
 *
 * The ordering rule is the important part: **every** daily task for every user
 * in the slice is emitted before any backfill task is considered. Fresh data is
 * what a user notices missing, and a backfill is by definition catching up on
 * something already years old. Interleaving them would let a large backfill
 * push today's data past tomorrow.
 *
 * Budgeting is greedy over `estimatedMs`, which only has to be right on
 * average — the executor also watches the wall clock and stops there, so an
 * underestimate costs a truncated run rather than an overrun.
 */
export function planInvocation(input: PlanInput): SyncPlan {
	const rotated = rotateAfter(input.users, input.cursorUserId);
	const skipped = { backfillComplete: 0, blocked: 0, upToDate: 0 };

	const daily: SyncTask[] = [];
	const backfill: SyncTask[] = [];

	for (const user of rotated) {
		const target = dailyTargetWindow(user.timeZone, input.now);
		const floorMs = backfillFloorMs(user, input);

		for (const dataTypeId of user.dataTypes) {
			if (user.blocked.has(dataTypeId)) {
				skipped.blocked += 1;
				continue;
			}

			const coverage = coverageFor(user, dataTypeId);

			const forward = nextForwardWindow(
				coverage,
				target,
				FORWARD_CHUNK_DAYS * DAY_MS,
			);
			if (forward !== null) {
				daily.push({
					dataTypeId,
					estimatedMs: ESTIMATED_TASK_MS.daily,
					kind: "daily",
					userId: user.userId,
					window: forward,
				});
			} else {
				skipped.upToDate += 1;
			}

			const backward = nextBackfillWindow(
				coverage,
				floorMs,
				BACKFILL_CHUNK_DAYS * DAY_MS,
			);
			if (backward === null) {
				skipped.backfillComplete += 1;
				continue;
			}
			backfill.push({
				dataTypeId,
				estimatedMs: ESTIMATED_TASK_MS.backfill,
				kind: "backfill",
				userId: user.userId,
				window: backward,
			});
		}
	}

	const { tasks, truncated } = sliceToBudget(
		[...daily, ...backfill],
		input.budgetMs,
	);

	return {
		nextCursorUserId: nextCursor(rotated, tasks, truncated),
		skipped,
		tasks,
		truncated,
	};
}

function sliceToBudget(
	ordered: readonly SyncTask[],
	budgetMs: number,
): { tasks: SyncTask[]; truncated: boolean } {
	const usable = budgetMs - BUDGET_RESERVE_MS;
	const tasks: SyncTask[] = [];
	let spent = 0;

	for (const task of ordered) {
		if (spent + task.estimatedMs > usable) {
			// At least one task always runs, even on a budget too small for it.
			// Emitting nothing would make an under-configured deployment look idle
			// rather than slow, and the executor's own deadline still bounds it.
			if (tasks.length === 0) {
				tasks.push(task);
				spent += task.estimatedMs;
				continue;
			}
			return { tasks, truncated: true };
		}
		tasks.push(task);
		spent += task.estimatedMs;
	}

	return { tasks, truncated: false };
}

/**
 * Where the next invocation picks up.
 *
 * On a complete pass the cursor advances to the last user in the slice, so the
 * next invocation starts with whoever comes after them. On a truncated pass it
 * stops at the last user actually reached, so nobody is skipped over — the
 * alternative loses a user's turn every time a budget runs out mid-rotation.
 */
function nextCursor(
	rotated: readonly PlannedUser[],
	tasks: readonly SyncTask[],
	truncated: boolean,
): string | undefined {
	if (rotated.length === 0) return undefined;
	if (!truncated) return rotated.at(-1)?.userId;
	const lastTouched = tasks.at(-1)?.userId;
	// A truncated plan that reached nobody leaves the cursor where it was, so the
	// same user is tried again rather than quietly skipped.
	return lastTouched;
}
