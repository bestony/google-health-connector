/**
 * The arithmetic behind "what has been synced, and what is owed".
 *
 * Coverage for a (user, data type) pair is one contiguous half-open range
 * rather than a set of ranges. That is not a simplification to be fixed later:
 * coverage only ever grows by two monotone motions from a single anchor — the
 * daily job extends the top, the backfill extends the bottom — and both windows
 * are computed *here*, from the current watermarks. A range set would buy
 * out-of-order parallel fetching that nothing needs, at the price of a second
 * table, a merge-and-compact pass, and a transaction around every write.
 *
 * The invariant that makes it safe is `mergeCoverage`: a window that neither
 * touches nor overlaps the existing range is refused outright, so a gap can
 * never be recorded as though it were covered. Everything downstream — the
 * planner, and the cache-first read path — trusts the watermarks completely, so
 * they must never be allowed to lie.
 *
 * Pure and import-free on purpose: the sync writes these values, the MCP read
 * path reads them, and the dashboard renders them.
 */

/** What has been synced. Both null until the first successful window lands. */
export interface SyncCoverage {
	fromMs: number | null;
	throughMs: number | null;
}

/** A half-open range of observation time, `[fromMs, throughMs)`. */
export interface SyncWindow {
	fromMs: number;
	throughMs: number;
}

/**
 * How many consecutive failures of any kind stop a pair being retried.
 *
 * The named permanent statuses (403, 404) are the expected way a pair goes
 * quiet. This is the backstop for everything else — a malformed filter after a
 * bad deploy, say, which is not permanent but is not going to fix itself
 * either. Ten attempts is roughly a week and a half of nightly runs, which is
 * long enough that a transient outage recovers on its own and short enough that
 * a genuine bug stops costing Google calls.
 */
export const MAX_CONSECUTIVE_FAILURES = 10;

/** `true` when the coverage is contiguous with, or overlaps, `window`. */
function isAdjacentOrOverlapping(
	coverage: SyncCoverage,
	window: SyncWindow,
): boolean {
	if (coverage.fromMs === null || coverage.throughMs === null) return true;
	// Half-open ranges: touching end-to-start is contiguous, not a gap.
	return (
		window.fromMs <= coverage.throughMs && window.throughMs >= coverage.fromMs
	);
}

export type MergeResult =
	| { ok: true; coverage: SyncCoverage }
	| { ok: false; reason: "gap" | "empty" };

/**
 * Widens coverage to include a window that was successfully fetched.
 *
 * Refuses rather than absorbing a disjoint window. A caller that hits this is
 * asking to record a range with a hole in it, and the hole would be invisible
 * afterwards: the read path would serve an empty stretch of cache as though it
 * were an empty stretch of the user's life.
 */
export function mergeCoverage(
	coverage: SyncCoverage,
	window: SyncWindow,
): MergeResult {
	if (window.throughMs <= window.fromMs) return { ok: false, reason: "empty" };
	if (!isAdjacentOrOverlapping(coverage, window)) {
		return { ok: false, reason: "gap" };
	}

	return {
		ok: true,
		coverage: {
			fromMs:
				coverage.fromMs === null
					? window.fromMs
					: Math.min(coverage.fromMs, window.fromMs),
			throughMs:
				coverage.throughMs === null
					? window.throughMs
					: Math.max(coverage.throughMs, window.throughMs),
		},
	};
}

/**
 * The next window the daily job should fetch, or `null` when nothing is owed.
 *
 * `target` is the window the caller wants fresh — in practice the last few
 * local days ending at D-2. Two things are deliberate:
 *
 * Re-reading an already-covered stretch is the point, not waste. Phones and
 * watches backfill into Google Health late and out of order, and the upsert is
 * idempotent, so re-reading the last few days every night is the cheapest
 * repair mechanism available.
 *
 * The window is clamped to `maxChunkMs` *and* anchored to the existing
 * watermark, so a user who stopped syncing for eight months walks forward in
 * bounded steps instead of being handed one enormous request — and every step
 * stays contiguous, which is what keeps `mergeCoverage` from refusing it.
 */
export function nextForwardWindow(
	coverage: SyncCoverage,
	target: SyncWindow,
	maxChunkMs: number,
): SyncWindow | null {
	if (target.throughMs <= target.fromMs) return null;

	if (coverage.throughMs === null) {
		return {
			fromMs: Math.max(target.fromMs, target.throughMs - maxChunkMs),
			throughMs: target.throughMs,
		};
	}

	if (coverage.throughMs >= target.throughMs) return null;

	const fromMs = Math.min(coverage.throughMs, target.fromMs);
	return {
		fromMs,
		throughMs: Math.min(target.throughMs, fromMs + maxChunkMs),
	};
}

/**
 * The next window the backfill should fetch, or `null` when it has reached the
 * floor — or when there is no anchor to walk back from yet.
 *
 * A pair with no coverage at all is the daily job's business first. Backfilling
 * from nothing would have to invent a starting point, and the one it would
 * invent is the window the daily job is about to fetch anyway.
 */
export function nextBackfillWindow(
	coverage: SyncCoverage,
	floorMs: number,
	chunkMs: number,
): SyncWindow | null {
	const anchor = coverage.fromMs;
	if (anchor === null || anchor <= floorMs) return null;

	const fromMs = Math.max(floorMs, anchor - chunkMs);
	return fromMs >= anchor ? null : { fromMs, throughMs: anchor };
}

/**
 * Whether the backfill has nothing older left to ask for.
 *
 * Derived from the watermark rather than stored, so it cannot disagree with it.
 * Moving the floor — a longer history window — makes this false again with no
 * migration and no flag to reset.
 */
export function isBackfillComplete(
	coverage: SyncCoverage,
	floorMs: number,
): boolean {
	return coverage.fromMs !== null && coverage.fromMs <= floorMs;
}

/**
 * Whether the cache can answer for `window` on its own.
 *
 * Total containment, not overlap: a partially covered window served from cache
 * would look to the caller like a complete answer that happens to be short,
 * which is a wrong answer rather than a slow one.
 */
export function coversWindow(
	coverage: SyncCoverage,
	window: SyncWindow,
): boolean {
	return (
		coverage.fromMs !== null &&
		coverage.throughMs !== null &&
		coverage.fromMs <= window.fromMs &&
		coverage.throughMs >= window.throughMs
	);
}

/**
 * Whether this status means "stop asking for this pair".
 *
 * A 403 is a consent category the user never granted, and a 404 is a data type
 * this account has no collection for. Both are answers about the account, not
 * about the request, and neither changes until the user does something.
 *
 * 401 is deliberately absent: better-auth refreshes the token, so an expired
 * one is transient. So is 400 — a filter this app built wrongly is fixed by a
 * deploy, not by the user — and `MAX_CONSECUTIVE_FAILURES` catches it anyway.
 */
export function isPermanentSyncFailure(status: number): boolean {
	return status === 403 || status === 404;
}

/** Whether a failure should take the pair out of the rotation. */
export function shouldDisableSync(
	status: number,
	failureCount: number,
): boolean {
	return (
		isPermanentSyncFailure(status) || failureCount >= MAX_CONSECUTIVE_FAILURES
	);
}
