import type {
	GoogleHealthCollectionKind,
	GoogleHealthTimeShape,
	RollupDataPoint,
} from "../google-health-api.gen";
import type { GoogleHealthRollupField } from "../google-health-rollup";

/**
 * Turning minute-level health data into hourly or daily buckets.
 *
 * A day of heart rate is two thousand points and a week of steps is ten
 * thousand, which is more than an assistant can read and far more than it
 * needs: the questions people ask — "how did I sleep this month", "is my
 * resting pulse drifting" — are about hours and days. This module is the
 * platform's own aggregation, used wherever Google's `rollUp` cannot be: for
 * stored history, and for the half of the catalog Google does not roll up.
 *
 * Like `health.ts`, deliberately free of MCP, HTTP and database types. The
 * tool decides where points come from; this module only decides what is true
 * about them once they are in hand.
 */

export type AggregateGranularity = "hour" | "day";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const BUCKET_MS: Record<AggregateGranularity, number> = {
	day: DAY_MS,
	hour: HOUR_MS,
};

/**
 * The most buckets one call will return.
 *
 * A year of days, or a little over a fortnight of hours. The cap is on how
 * much of a caller's context one tool call can spend — the same reasoning as
 * `MAX_LIMIT` on a raw read — and a window that exceeds it is refused rather
 * than shortened, because a silently shortened aggregate reads as "no data
 * after this date".
 */
export const MAX_AGGREGATE_BUCKETS = 366;

/** How far back an aggregate reaches when the caller names no `from`. */
export const DEFAULT_AGGREGATE_SPAN_MS: Record<AggregateGranularity, number> = {
	day: 7 * DAY_MS,
	hour: DAY_MS,
};

/** The widest offsets in use are UTC-12:00 and UTC+14:00. */
export const MIN_UTC_OFFSET_MINUTES = -12 * 60;
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

export interface AggregateWindow {
	/** Inclusive start, aligned to a bucket boundary. Epoch ms. */
	fromMs: number;
	/** Exclusive end, aligned to a bucket boundary. Epoch ms. */
	toMs: number;
	bucketMs: number;
	/** The offset bucket boundaries are drawn in, in ms east of UTC. */
	offsetMs: number;
	/** How many buckets the window holds, empty ones included. */
	buckets: number;
}

export interface AggregateWindowInput {
	fromMs: number;
	toMs: number;
	granularity: AggregateGranularity;
	utcOffsetMinutes: number;
}

/**
 * Widens a requested range outward to whole buckets.
 *
 * Outward rather than inward because a partial bucket is a wrong number that
 * looks like a right one: "steps today" computed from 09:14 onward is not the
 * day's steps. Every bucket this module returns is therefore whole, and the
 * reply states the window it actually used.
 *
 * Boundaries are drawn at a fixed UTC offset rather than in an IANA zone. That
 * misplaces one hour of data on the two days a year a zone changes its clocks,
 * and in exchange every bucket has the same length, the arithmetic is exact,
 * and the same boundaries can be handed to Google's `rollUp`, whose windows
 * are physical time too.
 */
export function alignAggregateWindow(
	input: AggregateWindowInput,
): AggregateWindow {
	const bucketMs = BUCKET_MS[input.granularity];
	const offsetMs = input.utcOffsetMinutes * MINUTE_MS;
	const fromMs =
		Math.floor((input.fromMs + offsetMs) / bucketMs) * bucketMs - offsetMs;
	const toMs =
		Math.ceil((input.toMs + offsetMs) / bucketMs) * bucketMs - offsetMs;

	return {
		bucketMs,
		buckets: Math.max(0, Math.round((toMs - fromMs) / bucketMs)),
		fromMs,
		offsetMs,
		toMs,
	};
}

/**
 * Moves a window's start forward to the first boundary at or after
 * `earliestMs`, for a request that reached past the history limit.
 *
 * Forward, where `alignAggregateWindow` widens backward, for the same reason:
 * the bucket that straddles the limit could only be partly filled, and a
 * partly filled bucket is a wrong number rather than a missing one.
 */
export function startAggregateWindowAt(
	window: AggregateWindow,
	earliestMs: number,
): AggregateWindow {
	if (window.fromMs >= earliestMs) return window;
	const { bucketMs, offsetMs } = window;
	const fromMs =
		Math.ceil((earliestMs + offsetMs) / bucketMs) * bucketMs - offsetMs;
	return {
		...window,
		buckets: Math.max(0, Math.round((window.toMs - fromMs) / bucketMs)),
		fromMs,
	};
}

/** `2026-09-14T00:00:00+08:00`: an instant, written on the caller's clock. */
export function formatWithOffset(atMs: number, offsetMs: number): string {
	const wallClock = new Date(atMs + offsetMs).toISOString().slice(0, 19);
	if (offsetMs === 0) return `${wallClock}Z`;

	const minutes = Math.abs(offsetMs) / MINUTE_MS;
	const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
	const mm = String(minutes % 60).padStart(2, "0");
	return `${wallClock}${offsetMs < 0 ? "-" : "+"}${hh}:${mm}`;
}

const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;
const DURATION_STRING = /^-?\d+(?:\.\d+)?s$/;

/** A number, an int64 sent as a string, or a `"3.5s"` duration in seconds. */
function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== "string") return undefined;
	if (NUMERIC_STRING.test(value)) return Number(value);
	if (DURATION_STRING.test(value)) return Number(value.slice(0, -1));
	return undefined;
}

/**
 * Every numeric leaf of a measurement, keyed by its dotted path.
 *
 * Generic on purpose, for the reason `summarizeDataPoint` passes measurements
 * through: forty per-type extractors would be forty things to keep in step with
 * Google, and `count`, `beatsPerMinute` and `summary.minutesAsleep` already say
 * what they are. Google sends 64-bit integers as strings and durations as
 * `"3.5s"`, so both are read as numbers here — typing `steps.count` by its
 * JSON type alone would make the most-asked-about field un-summable.
 *
 * Arrays are skipped: a sleep session's `stages` is a timeline, not a
 * measurement, and folding its members into one statistic would be noise.
 */
export function numericLeaves(
	value: Record<string, unknown>,
	prefix = "",
): [path: string, value: number][] {
	const leaves: [string, number][] = [];
	for (const [key, member] of Object.entries(value)) {
		const path = prefix === "" ? key : `${prefix}.${key}`;
		const numeric = toNumber(member);
		if (numeric !== undefined) {
			leaves.push([path, numeric]);
		} else if (
			typeof member === "object" &&
			member !== null &&
			!Array.isArray(member)
		) {
			leaves.push(...numericLeaves(member as Record<string, unknown>, path));
		}
	}
	return leaves;
}

/** Running statistics for one field. Associative, so hours merge into days. */
interface FieldAccumulator {
	count: number;
	sum: number;
	min: number;
	max: number;
}

type FieldAccumulators = Map<string, FieldAccumulator>;

function accumulate(into: FieldAccumulators, path: string, value: number) {
	const existing = into.get(path);
	if (existing === undefined) {
		into.set(path, { count: 1, max: value, min: value, sum: value });
		return;
	}
	existing.count += 1;
	existing.sum += value;
	existing.min = Math.min(existing.min, value);
	existing.max = Math.max(existing.max, value);
}

function mergeAccumulators(into: FieldAccumulators, from: FieldAccumulators) {
	for (const [path, stats] of from) {
		const existing = into.get(path);
		if (existing === undefined) {
			into.set(path, { ...stats });
			continue;
		}
		existing.count += stats.count;
		existing.sum += stats.sum;
		existing.min = Math.min(existing.min, stats.min);
		existing.max = Math.max(existing.max, stats.max);
	}
}

/** Six decimals: enough for any unit here, and it keeps `0.1 + 0.2` out. */
function round(value: number): number {
	return Number(value.toFixed(6));
}

export interface FieldStatistics {
	sum: number;
	avg: number;
	min: number;
	max: number;
}

/** A point reduced to what aggregation needs. */
export interface AggregatablePoint {
	/** The instant that decides the point's bucket. Epoch ms. */
	atMs: number;
	value: Record<string, unknown>;
	/** Identifies the recording device or app; `null` when Google named none. */
	sourceKey: string | null;
}

export interface AggregateBucket {
	start: string;
	end: string;
	/** How many points the statistics were computed from. */
	points: number;
	values: Record<string, FieldStatistics>;
}

export interface AggregateResult {
	buckets: AggregateBucket[];
	/** Points that fell inside the window, before any source was chosen. */
	pointsInWindow: number;
	/** Distinct data sources seen inside the window. */
	sources: number;
}

interface SourceTally {
	points: number;
	fields: FieldAccumulators;
}

/** The source that observed the most; ties go to the lower key, for stability. */
function primarySource(bySource: Map<string, SourceTally>): SourceTally {
	let winner: [string, SourceTally] | undefined;
	for (const candidate of bySource) {
		if (
			winner === undefined ||
			candidate[1].points > winner[1].points ||
			(candidate[1].points === winner[1].points && candidate[0] < winner[0])
		) {
			winner = candidate;
		}
	}
	// Only ever called for a slot that holds at least one source.
	return (winner as [string, SourceTally])[1];
}

/**
 * The span one data source is trusted over.
 *
 * Within a slot, only the source that observed the most is counted — see
 * `aggregatePoints`. An hour is short enough that a watch left on the charger
 * hands over to the phone within the hour. Sessions and daily summaries get a
 * whole day instead: two trackers rarely agree to the hour on when a night's
 * sleep ended, and an hourly slot would count that night twice.
 */
export function reconciliationSlotMs(
	type: {
		shape: GoogleHealthTimeShape;
		collection: GoogleHealthCollectionKind;
	},
	bucketMs: number,
): number {
	const preferred =
		type.shape === "daily" || type.collection === "session" ? DAY_MS : HOUR_MS;
	return Math.min(preferred, bucketMs);
}

/**
 * Aggregates points into the window's buckets.
 *
 * The part that is easy to get wrong is the same measurement arriving twice.
 * `dataPoints.list` returns every source's points, so a phone and a watch that
 * both counted a walk are two points, and a plain `SUM` doubles the walk.
 * Google's own rollup reconciles them; this one approximates that by cutting
 * the window into slots and, within each, counting only the source that
 * recorded the most. Slots then merge into buckets, so a day is the sum of its
 * reconciled hours rather than of one device's day — which is what keeps the
 * steps taken while the watch was charging.
 *
 * It is an approximation and the reply says so. It cannot overcount, which is
 * the failure that matters: an undercounted hour is a slightly low number, a
 * doubled day is a wrong conclusion about someone's health.
 *
 * A point belongs to the bucket its `atMs` falls in. An interval that straddles
 * a boundary is not split: the raw points are minutes long, so the error is at
 * most one point per boundary, and splitting would mean inventing a
 * distribution of the measurement within the interval.
 */
export function aggregatePoints(
	points: readonly AggregatablePoint[],
	window: AggregateWindow,
	slotMs: number,
): AggregateResult {
	const slots = new Map<number, Map<string, SourceTally>>();
	const sources = new Set<string>();
	let pointsInWindow = 0;

	for (const point of points) {
		if (point.atMs < window.fromMs || point.atMs >= window.toMs) continue;
		pointsInWindow += 1;

		const sourceKey = point.sourceKey ?? "";
		sources.add(sourceKey);

		const slot = Math.floor((point.atMs + window.offsetMs) / slotMs);
		let bySource = slots.get(slot);
		if (bySource === undefined) {
			bySource = new Map();
			slots.set(slot, bySource);
		}
		let tally = bySource.get(sourceKey);
		if (tally === undefined) {
			tally = { fields: new Map(), points: 0 };
			bySource.set(sourceKey, tally);
		}
		tally.points += 1;
		for (const [path, value] of numericLeaves(point.value)) {
			accumulate(tally.fields, path, value);
		}
	}

	const buckets = new Map<number, SourceTally>();
	for (const [slot, bySource] of slots) {
		const chosen = primarySource(bySource);
		const bucket = Math.floor((slot * slotMs) / window.bucketMs);
		const existing = buckets.get(bucket);
		if (existing === undefined) {
			const fields: FieldAccumulators = new Map();
			mergeAccumulators(fields, chosen.fields);
			buckets.set(bucket, { fields, points: chosen.points });
		} else {
			existing.points += chosen.points;
			mergeAccumulators(existing.fields, chosen.fields);
		}
	}

	return {
		buckets: [...buckets.entries()]
			.sort(([left], [right]) => left - right)
			.map(([bucket, tally]) => {
				const startMs = bucket * window.bucketMs - window.offsetMs;
				return {
					end: formatWithOffset(startMs + window.bucketMs, window.offsetMs),
					points: tally.points,
					start: formatWithOffset(startMs, window.offsetMs),
					values: Object.fromEntries(
						[...tally.fields.entries()]
							.sort(([left], [right]) => left.localeCompare(right))
							.map(([path, stats]) => [
								path,
								{
									avg: round(stats.sum / stats.count),
									max: stats.max,
									min: stats.min,
									sum: round(stats.sum),
								},
							]),
					),
				};
			}),
		pointsInWindow,
		sources: sources.size,
	};
}

export interface RollupBucket {
	start: string;
	end: string;
	/** Google's aggregate, passed through: `countSum`, `beatsPerMinuteAvg`, …. */
	values: Record<string, unknown>;
}

/**
 * One of Google's rollup windows, in the same envelope as a computed bucket.
 *
 * The aggregate is passed through rather than renamed. Google chooses which
 * statistic is meaningful per type — a sum for steps, an average for weight, a
 * breakdown by zone for active minutes — and its field names (`countSum`,
 * `weightGramsAvg`) already say which it chose. Returns `null` for a window
 * with nothing in it, so an idle night does not cost the caller eight buckets.
 */
export function summarizeRollupPoint(
	point: RollupDataPoint,
	field: GoogleHealthRollupField,
	offsetMs: number,
): RollupBucket | null {
	const values = point[field] as Record<string, unknown> | undefined;
	if (values === undefined || Object.keys(values).length === 0) return null;

	const startMs = Date.parse(point.startTime ?? "");
	const endMs = Date.parse(point.endTime ?? "");
	if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;

	return {
		end: formatWithOffset(endMs, offsetMs),
		start: formatWithOffset(startMs, offsetMs),
		values,
	};
}
