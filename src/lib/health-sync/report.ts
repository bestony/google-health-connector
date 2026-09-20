/**
 * What a run reports, built once and used twice.
 *
 * The HTTP response and the `health_sync_run` row are the same facts in two
 * shapes, so they come from one function rather than two places that can
 * disagree about what "partial" meant. The row is the durable half and matters
 * more than it looks: production defaults `LOG_LEVEL` to `error`, and Vercel's
 * log retention is short, so logs are the wrong place to answer "did last
 * night's sync run".
 */

export type RunOutcome =
	/** Everything owed was done. */
	| "completed"
	/** The budget ran out before the debt did. */
	| "partial"
	/** Another invocation holds the lease. Normal, not an incident. */
	| "skipped_locked"
	/** The kill switch is off. */
	| "skipped_disabled"
	/** Nothing was owed. */
	| "idle"
	/** The lease was stolen mid-run, so this run stopped writing. */
	| "lost_lease"
	/** The run itself threw. */
	| "failed";

export type RunTrigger = "cron" | "manual" | "dry-run";

/** Everything a run counts while it works. */
export interface RunCounters {
	usersConsidered: number;
	usersTouched: number;
	tasksPlanned: number;
	tasksRan: number;
	pointsInserted: number;
	pointsUpdated: number;
	retries: number;
	blocksWritten: number;
}

export function emptyCounters(): RunCounters {
	return {
		blocksWritten: 0,
		pointsInserted: 0,
		pointsUpdated: 0,
		retries: 0,
		tasksPlanned: 0,
		tasksRan: 0,
		usersConsidered: 0,
		usersTouched: 0,
	};
}

export interface RunSummaryInput {
	runId: string;
	trigger: RunTrigger;
	outcome: RunOutcome;
	startedAt: Date;
	finishedAt: Date;
	budgetMs: number;
	counters: RunCounters;
	/** True when debt remains that this invocation could not reach. */
	moreWork: boolean;
	error?: string;
}

export interface RunSummary {
	runId: string;
	trigger: RunTrigger;
	outcome: RunOutcome;
	durationMs: number;
	budgetMs: number;
	users: { considered: number; touched: number };
	tasks: { planned: number; ran: number };
	points: { inserted: number; updated: number };
	retries: number;
	blocksWritten: number;
	moreWork: boolean;
	nextHint: string;
	error?: string;
}

/**
 * One sentence telling the operator what to do next.
 *
 * Present because the most common question about a cron endpoint is "was that
 * supposed to happen?", and a `moreWork: true` that nobody acts on is a
 * backfill that never finishes.
 */
const HINTS: Record<RunOutcome, string> = {
	completed: "Everything owed was done.",
	failed: "The run failed. Check the logs under the health:sync scope.",
	idle: "Everything is up to date.",
	lost_lease:
		"The lease expired mid-run, which means the budget outlived it. Lower HEALTH_SYNC_BUDGET_MS or investigate a stalled run.",
	partial:
		"Work remains. Call again to continue; a scheduled run will also pick it up.",
	skipped_disabled: "Set HEALTH_SYNC_ENABLED=true to turn the sync on.",
	skipped_locked: "Another invocation is already running. Nothing to do.",
};

export function nextHintFor(outcome: RunOutcome, moreWork: boolean): string {
	// A finished run that left work behind says so, whichever of the two
	// finished outcomes it was.
	if (moreWork && (outcome === "completed" || outcome === "partial")) {
		return HINTS.partial;
	}
	return HINTS[outcome];
}

export function summarizeRun(input: RunSummaryInput): RunSummary {
	const summary: RunSummary = {
		blocksWritten: input.counters.blocksWritten,
		budgetMs: input.budgetMs,
		durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
		moreWork: input.moreWork,
		nextHint: nextHintFor(input.outcome, input.moreWork),
		outcome: input.outcome,
		points: {
			inserted: input.counters.pointsInserted,
			updated: input.counters.pointsUpdated,
		},
		retries: input.counters.retries,
		runId: input.runId,
		tasks: {
			planned: input.counters.tasksPlanned,
			ran: input.counters.tasksRan,
		},
		trigger: input.trigger,
		users: {
			considered: input.counters.usersConsidered,
			touched: input.counters.usersTouched,
		},
	};
	if (input.error !== undefined) summary.error = input.error;
	return summary;
}

/**
 * Whether a finished run did nothing because there was nothing to do.
 *
 * Distinguished from `completed` so a quiet night reads as quiet rather than as
 * a sync that ran and achieved nothing.
 */
export function outcomeFor(
	tasksPlanned: number,
	truncated: boolean,
): RunOutcome {
	if (tasksPlanned === 0) return "idle";
	return truncated ? "partial" : "completed";
}
