import { randomBytes } from "node:crypto";
import {
	acquireLease,
	finishRun,
	heartbeatLease,
	listRecentRuns,
	pruneRunLog,
	releaseLease,
	startRun,
} from "../../db/health-sync-run.server";
import {
	getCronSecretConfig,
	getHealthSyncBackfillDays,
	getHealthSyncBudgetMs,
	getHealthSyncDataTypes,
	isHealthSyncEnabled,
} from "../env.server";
import { createLogger } from "../logger.server";
import { loadPlannedUsers } from "./accounts.server";
import {
	DAY_MS,
	LEASE_ID,
	LEASE_SLACK_MS,
	MAX_BUDGET_SHARE_PER_USER,
	RUN_LOG_PAGE_SIZE,
	RUN_LOG_RETENTION_DAYS,
} from "./config";
import { extractCronCredential, secretsMatch } from "./credential.server";
import { isKnownDataType } from "./eligibility";
import { executePlan } from "./execute.server";
import { backfillFloorMs, planInvocation, type SyncPlan } from "./plan";
import {
	emptyCounters,
	outcomeFor,
	type RunOutcome,
	type RunTrigger,
	summarizeRun,
} from "./report";

/**
 * The HTTP bridge for the scheduler: `Request` in, `Response` out.
 *
 * Mirrors `mcp/handler.server.ts` — the route file stays a two-line binding and
 * everything about authentication, budgeting and teardown lives here.
 *
 * One response-code decision is worth stating, because it looks wrong at a
 * glance: **"someone else holds the lease" answers 200**, not 409. A systemd
 * `OnFailure=`, a Vercel cron retry and a Docker healthcheck all treat non-2xx
 * as an incident, and two invocations overlapping is normal operation on a
 * ten-minute schedule. Non-2xx is reserved for a caller that got something
 * wrong: 401 for a bad or missing secret, 404 while the feature is off, and 503
 * for the one genuinely broken configuration — enabled, but with no secret to
 * check against, which must fail closed rather than run unauthenticated.
 */

const log = createLogger("health:sync");

/**
 * The configured allowlist, narrowed to ids the catalog actually knows.
 *
 * Dropped rather than rejected: a typo should shrink the sync, not stop the
 * deployment from booting, and `env.server.ts` says so where the variable is
 * read.
 */
function configuredDataTypes() {
	return getHealthSyncDataTypes().filter(isKnownDataType);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json",
		},
		status,
	});
}

/**
 * The feature's front door, shared by both routes.
 *
 * Fails closed in the same order every time: off before unconfigured, and
 * unconfigured before unauthenticated, so a probe cannot learn whether a secret
 * is set on a deployment that has the feature turned off.
 */
function guard(request: Request): Response | null {
	if (!isHealthSyncEnabled()) {
		return json({ error: "Not found" }, 404);
	}

	const secret = getCronSecretConfig();
	if (secret.status === "unconfigured") {
		log.error("sync is enabled but has no secret", { missing: secret.missing });
		return json(
			{
				error:
					"The sync is enabled but CRON_SECRET is not set, so this endpoint cannot authenticate its caller.",
			},
			503,
		);
	}

	if (!secretsMatch(extractCronCredential(request.headers), secret.secret)) {
		// Logged because a misconfigured secret otherwise looks exactly like a
		// sync that quietly stopped running.
		log.warn("rejected a cron request", {
			path: new URL(request.url).pathname,
		});
		return json({ error: "Unauthorized" }, 401);
	}

	return null;
}

function triggerOf(request: Request): RunTrigger {
	const url = new URL(request.url);
	if (url.searchParams.get("dryRun") !== null) return "dry-run";
	// Vercel Cron identifies itself; anything else is a human or a timer.
	return request.headers.get("x-vercel-signature") === null &&
		request.headers.get("user-agent")?.includes("vercel-cron") !== true
		? "manual"
		: "cron";
}

/** `GET|POST /api/cron/sync` — one time-budgeted slice of work. */
export async function handleSyncRequest(request: Request): Promise<Response> {
	const refusal = guard(request);
	if (refusal !== null) return refusal;

	const startedAt = new Date();
	const runId = randomBytes(16).toString("hex");
	const trigger = triggerOf(request);
	const budgetMs = getHealthSyncBudgetMs();
	const backfillDays = getHealthSyncBackfillDays();

	if (trigger === "dry-run") {
		return json(await dryRun(runId, startedAt, budgetMs, backfillDays));
	}

	const lease = await acquireLease(
		LEASE_ID,
		budgetMs + LEASE_SLACK_MS,
		startedAt,
	);
	if (!lease.acquired) {
		return json(
			summarizeRun({
				budgetMs,
				counters: emptyCounters(),
				finishedAt: new Date(),
				moreWork: true,
				outcome: "skipped_locked",
				runId,
				startedAt,
				trigger,
			}),
		);
	}

	await startRun({ id: runId, startedAt, trigger });

	try {
		const summary = await runSlice({
			backfillDays,
			budgetMs,
			leaseToken: lease.token,
			runId,
			startedAt,
			trigger,
			cursorUserId: lease.cursorUserId,
		});
		return json(summary);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log.error("run failed", { error: message, runId });
		const finishedAt = new Date();
		await finishRun(runId, { error: message, finishedAt, outcome: "failed" });
		return json(
			summarizeRun({
				budgetMs,
				counters: emptyCounters(),
				error: message,
				finishedAt,
				moreWork: true,
				outcome: "failed",
				runId,
				startedAt,
				trigger,
			}),
		);
	} finally {
		// Released even on the error path, so a thrown run does not hold the lease
		// for a full TTL. The fencing token means this is a no-op if it was lost.
		await releaseLease(LEASE_ID, lease.token, lease.cursorUserId, new Date());
	}
}

/**
 * A losing lease outranks everything: a run that stopped writing half way
 * through did not complete, whatever its counters say.
 */
function resolveOutcome(
	lostLease: boolean,
	moreWork: boolean,
	tasksPlanned: number,
	truncated: boolean,
): RunOutcome {
	if (lostLease) return "lost_lease";
	if (moreWork && tasksPlanned > 0) return "partial";
	return outcomeFor(tasksPlanned, truncated);
}

interface SliceOptions {
	runId: string;
	trigger: RunTrigger;
	startedAt: Date;
	budgetMs: number;
	backfillDays: number;
	leaseToken: string;
	cursorUserId: string | undefined;
}

async function runSlice(options: SliceOptions) {
	const counters = emptyCounters();
	const deadlineMs = options.startedAt.getTime() + options.budgetMs;

	const loaded = await loadPlannedUsers(
		options.startedAt,
		configuredDataTypes(),
	);
	counters.usersConsidered = loaded.users.length;

	const planInput = {
		backfillDays: options.backfillDays,
		budgetMs: options.budgetMs,
		cursorUserId: options.cursorUserId,
		now: options.startedAt,
		users: loaded.users,
	};
	const plan: SyncPlan = planInvocation(planInput);
	counters.tasksPlanned = plan.tasks.length;

	log.info("run started", {
		budgetMs: options.budgetMs,
		runId: options.runId,
		tasks: plan.tasks.length,
		trigger: options.trigger,
		users: loaded.users.length,
	});

	const result = await executePlan(plan.tasks, {
		counters,
		deadlineMs,
		floorMsByUser: new Map(
			loaded.users.map((user) => [
				user.userId,
				backfillFloorMs(user, planInput),
			]),
		),
		maxMsPerUser: Math.floor(options.budgetMs * MAX_BUDGET_SHARE_PER_USER),
		now: options.startedAt,
		stillLeased: () =>
			heartbeatLease(
				LEASE_ID,
				options.leaseToken,
				options.budgetMs + LEASE_SLACK_MS,
				new Date(),
			),
	});

	const moreWork = plan.truncated || result.remaining > 0;
	const outcome = resolveOutcome(
		result.lostLease,
		moreWork,
		plan.tasks.length,
		plan.truncated,
	);

	const finishedAt = new Date();
	await finishRun(options.runId, {
		blocksWritten: counters.blocksWritten,
		finishedAt,
		moreWork,
		outcome,
		pointsInserted: counters.pointsInserted,
		pointsUpdated: counters.pointsUpdated,
		retries: counters.retries,
		tasksPlanned: counters.tasksPlanned,
		tasksRan: counters.tasksRan,
		usersConsidered: counters.usersConsidered,
		usersTouched: counters.usersTouched,
	});
	await pruneRunLog(
		new Date(finishedAt.getTime() - RUN_LOG_RETENTION_DAYS * DAY_MS),
	);

	// The cursor moves to whoever was actually reached, so a truncated run does
	// not skip the user it stopped before.
	await releaseLease(
		LEASE_ID,
		options.leaseToken,
		result.lastUserId ?? plan.nextCursorUserId,
		finishedAt,
	);

	const summary = summarizeRun({
		budgetMs: options.budgetMs,
		counters,
		finishedAt,
		moreWork,
		outcome,
		runId: options.runId,
		startedAt: options.startedAt,
		trigger: options.trigger,
	});

	log.info("run finished", {
		durationMs: summary.durationMs,
		inserted: counters.pointsInserted,
		moreWork,
		outcome,
		runId: options.runId,
		tasksRan: counters.tasksRan,
	});

	return summary;
}

/**
 * `?dryRun=1` — what this invocation *would* do.
 *
 * Takes no lease and writes nothing, so it is safe to run against production
 * while a real invocation is in flight. This is the first thing to reach for
 * when a sync is not doing what somebody expected.
 */
async function dryRun(
	runId: string,
	startedAt: Date,
	budgetMs: number,
	backfillDays: number,
) {
	const loaded = await loadPlannedUsers(startedAt, configuredDataTypes());
	const plan = planInvocation({
		backfillDays,
		budgetMs,
		cursorUserId: undefined,
		now: startedAt,
		users: loaded.users,
	});

	return {
		budgetMs,
		dryRun: true,
		optedIn: loaded.optedIn,
		plan: {
			backfill: plan.tasks.filter((task) => task.kind === "backfill").length,
			daily: plan.tasks.filter((task) => task.kind === "daily").length,
			skipped: plan.skipped,
			truncated: plan.truncated,
		},
		runId,
		tasks: plan.tasks.slice(0, 50).map((task) => ({
			dataType: task.dataTypeId,
			from: new Date(task.window.fromMs).toISOString(),
			kind: task.kind,
			to: new Date(task.window.throughMs).toISOString(),
			userId: task.userId,
		})),
		usersEligible: loaded.users.length,
	};
}

/** `GET /api/cron/status` — the recent run log, for "did last night's sync run". */
export async function handleStatusRequest(request: Request): Promise<Response> {
	const refusal = guard(request);
	if (refusal !== null) return refusal;

	const runs = await listRecentRuns(RUN_LOG_PAGE_SIZE);
	return json({
		note: "A run with finishedAt null and an old startedAt was killed mid-flight, which is what a platform timeout looks like from here.",
		runs,
	});
}
