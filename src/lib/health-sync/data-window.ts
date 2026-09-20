import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import { googleHealthDataType } from "../google-health-filter";
import type { SyncWindow } from "../google-health-sync-window";

/**
 * Turning a window the planner wants into a request the API will accept.
 *
 * Almost every data type takes a two-sided time range and this module is a
 * pass-through. The exception is the one that matters: `dataPointTimeFilter`
 * *throws* when handed an upper bound for `electrocardiogram`, because Google
 * accepts only `>=` on an ECG's start time. That throw is correct — silently
 * widening a one-day request into "everything since" is exactly the bug it
 * prevents — but it means a caller sweeping every data type over a window has
 * to know about it in advance.
 *
 * Encoding it here, once, is what stops that knowledge living as a remembered
 * fact in the executor. Sleep needs nothing special: `google-health-filter.ts`
 * already redirects it to `interval.end_time`, which is the right behaviour for
 * a window sync too — a night that began before the window still belongs to it.
 *
 * Pure, and unit-tested against the real catalog rather than a fixture, so a
 * regeneration that changed a type's shape would be caught here.
 */

/** Google accepts only a lower bound on these, whatever the caller wants. */
const LOWER_BOUND_ONLY = new Set<GoogleHealthDataTypeId>(["electrocardiogram"]);

export interface PlannedRequest {
	/** Handed straight to the API client's `from`/`to`. */
	from: Date;
	to: Date | undefined;
	/**
	 * Set when the request could not be bounded from above, and the caller must
	 * drop points at or after this instant itself.
	 *
	 * Ignoring it means storing points from outside the window the run believes
	 * it covered, which would make the coverage watermark a lie in the one
	 * direction nothing downstream checks.
	 */
	filterBefore: Date | undefined;
}

/** Whether Google refuses an upper time bound on this data type. */
export function acceptsUpperBound(id: GoogleHealthDataTypeId): boolean {
	return !LOWER_BOUND_ONLY.has(id);
}

/**
 * The request that fetches `window` for `id`.
 *
 * Throws for an unknown id, which is `googleHealthDataType`'s behaviour and
 * worth keeping: an id that is not in the catalog produces a resource path that
 * 404s with nothing to explain it.
 */
export function planTimeWindow(
	id: GoogleHealthDataTypeId,
	window: SyncWindow,
): PlannedRequest {
	// Validates the id even when the branch below does not need the result.
	googleHealthDataType(id);

	const from = new Date(window.fromMs);
	const to = new Date(window.throughMs);

	if (!acceptsUpperBound(id)) {
		return { filterBefore: to, from, to: undefined };
	}

	return { filterBefore: undefined, from, to };
}

/**
 * Drops points the request could not exclude on Google's side.
 *
 * A no-op for every type that accepts an upper bound, which is why the caller
 * can apply it unconditionally rather than remembering which types need it.
 */
export function withinPlannedWindow<T extends { observedAtMs: number }>(
	points: readonly T[],
	request: PlannedRequest,
): T[] {
	const before = request.filterBefore;
	if (before === undefined) return [...points];
	const limit = before.getTime();
	return points.filter((point) => point.observedAtMs < limit);
}
