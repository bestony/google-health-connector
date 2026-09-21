import type { RollupDataPoint } from "./google-health-api.gen";

/**
 * What `users.dataTypes.dataPoints.rollUp` can aggregate, and how much of it
 * one request may cover.
 *
 * Google reconciles a rollup across every data source before summing it, which
 * is the one thing this app cannot reproduce from raw points: a phone and a
 * watch that both counted the same walk are two points in `dataPoints.list`
 * and one walk in a rollup. So where a rollup exists it is the better answer,
 * and this module is how a caller finds out whether it does.
 *
 * Pure data and arithmetic, like `google-health-filter.ts`: no imports beyond
 * the generated types, safe on either side of the server boundary.
 */

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The members of `RollupDataPoint` that carry an aggregate, not its window. */
export type GoogleHealthRollupField = Exclude<
	keyof RollupDataPoint,
	"startTime" | "endTime"
>;

export interface GoogleHealthRollupType {
	/** Path segment: `users/me/dataTypes/{id}`. Kebab-case. */
	id: string;
	/** Key on `RollupDataPoint` carrying this type's aggregate. Camel-case. */
	field: GoogleHealthRollupField;
	/**
	 * Derived by Google and readable only as a rollup: there is no collection of
	 * raw points behind it, so `dataPoints.list` cannot name it.
	 */
	rollupOnly: boolean;
	/** The longest range one `rollUp` request may cover, in days. */
	maxRangeDays: number;
}

/** Google's documented range limit for most types. */
const DEFAULT_MAX_RANGE_DAYS = 90;

/**
 * The four types Google limits to a fortnight per request — the ones dense
 * enough that a quarter of them is too much to aggregate in one call.
 */
const SHORT_MAX_RANGE_DAYS = 14;

/**
 * Keyed by `RollupDataPoint` member on purpose: `Record` over the generated
 * key union makes the compiler enforce both directions. A member Google adds
 * is a missing key here, and one it removes is an unknown key, so a
 * regeneration that changes what can be rolled up fails `tsc` rather than
 * going unnoticed. The ids and range limits come from Google's prose on
 * `RollupDataPoint` and `RollUpDataPointsRequest`, which no schema encodes.
 */
const ROLLUP_TYPES_BY_FIELD: Record<
	GoogleHealthRollupField,
	{ id: string; rollupOnly?: true; maxRangeDays?: number }
> = {
	activeEnergyBurned: { id: "active-energy-burned" },
	activeMinutes: { id: "active-minutes", maxRangeDays: SHORT_MAX_RANGE_DAYS },
	activeZoneMinutes: { id: "active-zone-minutes" },
	activityLevel: { id: "activity-level" },
	altitude: { id: "altitude" },
	bloodGlucose: { id: "blood-glucose" },
	bodyFat: { id: "body-fat" },
	caloriesInHeartRateZone: {
		id: "calories-in-heart-rate-zone",
		maxRangeDays: SHORT_MAX_RANGE_DAYS,
		rollupOnly: true,
	},
	coreBodyTemperature: { id: "core-body-temperature" },
	distance: { id: "distance" },
	floors: { id: "floors" },
	heartRate: { id: "heart-rate", maxRangeDays: SHORT_MAX_RANGE_DAYS },
	hydrationLog: { id: "hydration-log" },
	nutritionLog: { id: "nutrition-log" },
	runVo2Max: { id: "run-vo2-max" },
	sedentaryPeriod: { id: "sedentary-period" },
	steps: { id: "steps" },
	swimLengthsData: { id: "swim-lengths-data" },
	timeInHeartRateZone: { id: "time-in-heart-rate-zone" },
	totalCalories: {
		id: "total-calories",
		maxRangeDays: SHORT_MAX_RANGE_DAYS,
		rollupOnly: true,
	},
	weight: { id: "weight" },
};

/** Every data type Google can roll up, ordered by id. */
export const GOOGLE_HEALTH_ROLLUP_TYPES: readonly GoogleHealthRollupType[] = (
	Object.entries(ROLLUP_TYPES_BY_FIELD) as [
		GoogleHealthRollupField,
		(typeof ROLLUP_TYPES_BY_FIELD)[GoogleHealthRollupField],
	][]
)
	.map(([field, entry]) => ({
		field,
		id: entry.id,
		maxRangeDays: entry.maxRangeDays ?? DEFAULT_MAX_RANGE_DAYS,
		rollupOnly: entry.rollupOnly === true,
	}))
	.sort((left, right) => left.id.localeCompare(right.id));

const BY_ID = new Map(
	GOOGLE_HEALTH_ROLLUP_TYPES.map((type) => [type.id, type]),
);

/** The rollup behind `id`, or `undefined` when Google cannot roll it up. */
export function googleHealthRollupType(
	id: string,
): GoogleHealthRollupType | undefined {
	return BY_ID.get(id);
}

/** `3_600_000` → `"3600s"`, the `google-duration` a `windowSize` wants. */
export function rollupWindowSize(windowMs: number): string {
	return `${windowMs / 1000}s`;
}

export interface RollupSlice {
	fromMs: number;
	toMs: number;
}

/**
 * Cuts `[fromMs, toMs)` into requests Google will accept.
 *
 * Every slice but the last is a whole number of windows long, so the windows
 * Google draws inside a later slice line up with the ones a single, unlimited
 * request would have drawn. Cutting at the raw range limit instead would start
 * a slice mid-window whenever the limit is not a multiple of the window, and
 * the two halves of that window would come back as two separate aggregates.
 */
export function rollupSlices(
	type: GoogleHealthRollupType,
	range: RollupSlice,
	windowMs: number,
): RollupSlice[] {
	const maxMs = type.maxRangeDays * DAY_MS;
	const sliceMs = Math.max(windowMs, Math.floor(maxMs / windowMs) * windowMs);

	const slices: RollupSlice[] = [];
	for (let start = range.fromMs; start < range.toMs; start += sliceMs) {
		slices.push({
			fromMs: start,
			toMs: Math.min(start + sliceMs, range.toMs),
		});
	}
	return slices;
}
