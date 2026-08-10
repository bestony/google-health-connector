import {
	GOOGLE_HEALTH_DATA_POINT_TYPES,
	type GoogleHealthDataPointType,
	type GoogleHealthDataTypeId,
} from "./google-health-api.gen";

/**
 * Filter expressions for `users.dataTypes.dataPoints.list`.
 *
 * The API filters by time with an [AIP-160](https://google.aip.dev/160)
 * expression, and which field that expression may name depends on the data
 * type: an interval collection is filtered on `interval.start_time`, a sample
 * collection on `sample_time.physical_time`, a daily summary on `date`, and a
 * session collection on `interval.civil_start_time`. Get it wrong and the API
 * can reject the request or return an empty page.
 *
 * Two session types then break that rule, and Google says so explicitly:
 *
 * - **Sleep** is filtered on its *end* time. A session that began before the
 *   window and ended inside it is the normal case for sleep, so filtering on
 *   the start would drop exactly the night the caller asked about.
 * - **Electrocardiogram** supports `>=` on the start time and nothing else.
 *   There is no upper bound to give it.
 *
 * This module exists so no caller has to know any of that.
 *
 * It is pure string building: no imports beyond the generated catalog, nothing
 * server-only, safe to use on either side.
 */

/** Indexed once; the catalog is a constant and the lookup is on a hot path. */
const BY_ID = new Map<string, GoogleHealthDataPointType>(
	GOOGLE_HEALTH_DATA_POINT_TYPES.map((type) => [type.id, type]),
);

export function googleHealthDataType(
	id: GoogleHealthDataTypeId,
): GoogleHealthDataPointType {
	const type = BY_ID.get(id);
	if (!type) {
		// Only reachable from untyped callers, and worth failing loudly for: the
		// alternative is a resource path that 404s with nothing to explain it.
		throw new Error(`Unknown Google Health data type: ${id}`);
	}
	return type;
}

/**
 * The time field a filter on `id` has to name, and whether it can be bounded
 * from above.
 */
interface TimeField {
	/** Field path, relative to the data type, in the filter's proto casing. */
	path: string;
	/** Whether the API accepts an upper bound on it. */
	rangeable: boolean;
	/** How a bound is rendered: an instant, civil date-time, or calendar day. */
	literal: "timestamp" | "civilDateTime" | "date";
}

function timeField(type: GoogleHealthDataPointType): TimeField {
	// Sleep and ECG are documented exceptions to the shape rule. Keeping them
	// here, rather than in the generated catalog, is deliberate: they come from
	// Google's prose, not from the schema, so a regeneration must not silently
	// drop them.
	if (type.id === "sleep") {
		return { path: "interval.end_time", rangeable: true, literal: "timestamp" };
	}
	if (type.id === "electrocardiogram") {
		return {
			path: "interval.start_time",
			rangeable: false,
			literal: "timestamp",
		};
	}
	if (type.collection === "session") {
		return {
			path: "interval.civil_start_time",
			rangeable: true,
			literal: "civilDateTime",
		};
	}

	switch (type.shape) {
		case "interval":
			return {
				path: "interval.start_time",
				rangeable: true,
				literal: "timestamp",
			};
		case "sample":
			return {
				path: "sample_time.physical_time",
				rangeable: true,
				literal: "timestamp",
			};
		case "daily":
			return { path: "date", rangeable: true, literal: "date" };
	}
}

/** `2026-08-10T12:34:56.000Z`, which is the RFC 3339 the API expects. */
function timestampLiteral(at: Date): string {
	return at.toISOString();
}

/**
 * `2026-08-10T12:34:56`, without an offset as Google's civil filter requires.
 *
 * `Date` has already normalized the caller's instant to UTC. The API interprets
 * the resulting wall time in the user's local timezone. This is the same UTC
 * convention used for daily filters below and keeps the conversion explicit.
 */
function civilDateTimeLiteral(at: Date): string {
	return at.toISOString().slice(0, 19);
}

/**
 * `2026-08-10`, in UTC.
 *
 * Daily summaries are keyed by calendar date, and the caller's timezone is not
 * something this module can know. UTC is stated rather than guessed, so a
 * caller who needs local days can pass dates already shifted.
 */
function dateLiteral(at: Date): string {
	return at.toISOString().slice(0, 10);
}

export interface TimeRange {
	/** Inclusive lower bound. */
	from?: Date;
	/** Exclusive upper bound. */
	to?: Date;
}

/**
 * A filter selecting the points of `id` that fall in `range`.
 *
 * Returns `undefined` when the range is empty, because that is what the API's
 * `filter` parameter wants for "no filter" — an empty string would be a parse
 * error.
 *
 * Throws when an upper bound is given for a type that cannot take one, rather
 * than dropping it: silently widening a caller's window to "everything since"
 * is how a request meant to read one day reads a year.
 */
export function dataPointTimeFilter(
	id: GoogleHealthDataTypeId,
	range: TimeRange,
): string | undefined {
	const type = googleHealthDataType(id);
	const field = timeField(type);
	const render =
		field.literal === "date"
			? dateLiteral
			: field.literal === "civilDateTime"
				? civilDateTimeLiteral
				: timestampLiteral;

	if (range.to !== undefined && !field.rangeable) {
		throw new Error(
			`Google Health does not support an upper time bound on "${id}"; ` +
				`only \`${field.path} >=\` is accepted. Filter the results instead.`,
		);
	}

	if (
		range.from !== undefined &&
		range.to !== undefined &&
		range.from.getTime() > range.to.getTime()
	) {
		throw new Error(
			`Time range for "${id}" starts after it ends: ` +
				`${range.from.toISOString()} > ${range.to.toISOString()}`,
		);
	}

	const clauses: string[] = [];
	const prefix = `${type.filterId}.${field.path}`;

	if (range.from !== undefined) {
		clauses.push(`${prefix} >= "${render(range.from)}"`);
	}
	if (range.to !== undefined) {
		clauses.push(`${prefix} < "${render(range.to)}"`);
	}

	return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

/**
 * The resource path of a data type's collection.
 *
 * `user` is `me` for the signed-in user, which is the only value this app has a
 * token for.
 */
export function dataPointsParent(
	id: GoogleHealthDataTypeId,
	user = "me",
): string {
	return `users/${user}/dataTypes/${googleHealthDataType(id).id}`;
}
