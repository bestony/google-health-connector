/**
 * Every tuning constant the background sync has, and why it has that value.
 *
 * These are constants rather than environment variables on purpose, following
 * the argument `api-key-config.ts` already makes for `API_KEY_RATE_LIMIT`: each
 * one needs a paragraph of justification and a unit test far more than it needs
 * a deployment-time knob. A number somebody can change without reading the
 * reasoning is a number that gets changed without reading the reasoning.
 *
 * The five things that genuinely vary by deployment — whether the sync runs at
 * all, the shared secret, the invocation budget, the backfill floor and the
 * data-type allowlist — are environment variables in `env.server.ts`.
 *
 * Pure data. No imports, so both the planner and its tests read the same values.
 */

/** A day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days back the daily sync anchors on.
 *
 * Two. A day's data is still settling while devices sync and Google derives its
 * daily summaries from the samples underneath them, so reading yesterday gets a
 * partial answer that then has to be re-read anyway. By D-2 the day is done.
 */
export const DAILY_ANCHOR_DAYS = 2;

/**
 * How many local days the daily window covers, ending at the anchor.
 *
 * Three, so a run reads D-4 through D-2. D-2 is the right anchor but the wrong
 * *window*: phones and watches backfill into Google Health late and out of
 * order, and a user who left a watch on the charger for a day drops a hole into
 * a window that only ever looked at one day.
 *
 * Re-reading is close to free — the upsert is idempotent by construction and
 * the identity digest makes a re-read land on the same row — so this is the
 * cheapest repair mechanism available, and it needs no separate reconciliation
 * pass to exist.
 */
export const DAILY_LOOKBACK_DAYS = 3;

/**
 * The largest window a single forward request will ask for, in days.
 *
 * Reached only when a user has been away long enough for the watermark to fall
 * behind the daily window — the sync then walks forward in steps this size
 * rather than asking Google for eight months at once.
 */
export const FORWARD_CHUNK_DAYS = 14;

/**
 * How much history one backfill request reaches for, in days.
 *
 * Fourteen days balances two failure modes. Too small and a year of history
 * needs twenty-six invocations per data type, which on a platform allowing one
 * cron a day is most of a month. Too large and a single request can time out or
 * page for minutes, and the executor abandons an over-budget chunk, so the work
 * is not just slow but wasted.
 */
export const BACKFILL_CHUNK_DAYS = 14;

/**
 * How many users one invocation will consider.
 *
 * Bounds the planner's cost independently of how many users exist: it reads
 * sync state for this many and no more, starting from the rotation cursor. The
 * executor's own budget then decides how many of them are actually reached.
 */
export const USERS_PER_RUN = 25;

/**
 * How many Google requests are in flight at once, for one user.
 *
 * Nothing else in this app throttles outbound calls to Google — the API client
 * has no retry loop, no token bucket and no concurrency cap — so this constant
 * *is* the throttle. Four is the difference between a polite client and a
 * self-inflicted 429.
 */
export const CONCURRENCY = 4;

/**
 * The fraction of an invocation's budget one user may consume.
 *
 * A third, so a user with a slow connection or a great deal of history cannot
 * starve the two behind them in the rotation. Enforced on the wall clock, not
 * on a request count, because it is wall clock that the platform kills.
 */
export const MAX_BUDGET_SHARE_PER_USER = 1 / 3;

/**
 * Time held back from the budget so a run can finish cleanly.
 *
 * Checkpointing, releasing the lease and writing the run log all have to happen
 * inside the platform's invocation limit, after the last task returns. A run
 * that spends its budget down to zero is a run that gets killed while writing
 * its own bookkeeping.
 */
export const BUDGET_RESERVE_MS = 1_500;

/** Rough cost of one task, used only for budget arithmetic before any work runs. */
export const ESTIMATED_TASK_MS = {
	backfill: 400,
	daily: 250,
} as const;

/** How many times a retryable failure is retried within one invocation. */
export const MAX_ATTEMPTS = 3;

/** First backoff step. Full jitter is applied on top. */
export const BACKOFF_BASE_MS = 500;

/** The longest a backoff will wait, before jitter. */
export const BACKOFF_CAP_MS = 4_000;

/**
 * How long a pair rests after exhausting its retries.
 *
 * An hour. Long enough that a Google-side incident is not hammered, short
 * enough that a deployment which fixes the cause takes effect the same day.
 */
export const ERROR_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * How long a permanently failed pair waits before being probed again.
 *
 * Seven days. A 403 means the user never granted that consent category, and the
 * only thing that changes it is the user granting it — which they may well do
 * next week. Re-probing weekly is what lets a later grant take effect with no
 * operator involvement, at a cost of one request per pair per week.
 *
 * Granting a category through the dashboard clears the block immediately, so
 * this is the fallback for the case where Google's own screen was used instead.
 */
export const BLOCK_RETRY_DAYS = 7;

/**
 * Slack added to the invocation budget to get the lease's time-to-live.
 *
 * The lease must outlive the work it protects, including a run that is killed
 * at the platform's timeout without getting to release it. Thirty seconds past
 * the budget means such a run self-heals one TTL later, with no janitor and no
 * cleanup job.
 */
export const LEASE_SLACK_MS = 30_000;

/** The single lease row. A primary key so sharding later is config, not migration. */
export const LEASE_ID = "default";

/** How long run-log rows are kept before a run sweeps them away. */
export const RUN_LOG_RETENTION_DAYS = 30;

/** How many run rows `GET /api/cron/status` returns. */
export const RUN_LOG_PAGE_SIZE = 20;

/**
 * The most points one invocation will write for a single user.
 *
 * A guard against a backfill of a dense sample type filling a disk before
 * anybody notices. Hitting it ends the user's turn; the next invocation picks
 * up where the watermark was last checkpointed, so nothing is lost.
 */
export const MAX_POINTS_PER_USER_RUN = 50_000;
