import {
	type DataPoint,
	GOOGLE_HEALTH_DATA_POINT_TYPES,
	GOOGLE_HEALTH_READ_SCOPES,
} from "../google-health-api.gen";
import { FREE_HISTORY_DAYS } from "../plans";

/**
 * The parts of the health MCP tools worth having outside a transport: the
 * history window, the shape of what a tool hands back, and the catalog a client
 * discovers types from.
 *
 * Deliberately free of MCP and HTTP types, like `hello.ts` was before it. The
 * tool registrations in `server.ts` decide how to phrase a protocol response;
 * this module only decides what is true.
 */

/** A day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back a read may reach.
 *
 * The free tier's window, applied to everyone: there is no billing and no plan
 * column on the user, so there is nothing to tell a subscriber apart with.
 */
export const HISTORY_LIMIT_DAYS = FREE_HISTORY_DAYS;

export interface HistoryWindow {
	from: Date;
	to: Date | undefined;
}

export interface ClampedWindow extends HistoryWindow {
	/** Whether `from` was moved forward to satisfy the history limit. */
	clamped: boolean;
	/** The limit that was applied, in days. */
	limitDays: number;
}

/**
 * Constrains a requested window to the history the account is entitled to.
 *
 * The limit applies to everyone for now. There is no billing and no plan column
 * on the user, so there is nothing to tell a subscriber from anyone else —
 * applying the free tier's window to all is the honest reading of that, and
 * relaxing it later is a change to this one function.
 *
 * A caller that asks for more gets less *and is told so*: silently returning
 * three months when a year was asked for would have a model conclude the user
 * simply has no older data, which is a wrong answer rather than a limitation.
 */
export function clampHistoryWindow(
	window: Partial<HistoryWindow>,
	now: Date,
	limitDays: number = HISTORY_LIMIT_DAYS,
): ClampedWindow {
	const earliest = new Date(now.getTime() - limitDays * DAY_MS);
	const requested = window.from ?? earliest;
	const clamped = requested.getTime() < earliest.getTime();

	return {
		from: clamped ? earliest : requested,
		to: window.to,
		clamped,
		limitDays,
	};
}

/** One data point, flattened to what an assistant can reason about. */
export interface DataPointSummary {
	/** The data type's key on `DataPoint`, e.g. `steps`. */
	type: string;
	/** RFC 3339, or a `YYYY-MM-DD` for daily summaries. */
	start?: string;
	end?: string;
	/** The payload with its time field removed — the measurement itself. */
	value: Record<string, unknown>;
	/** Present only for the identifiable types that carry one. */
	name?: string;
}

/** `{ year: 2026, month: 8, day: 10 }` → `2026-08-10`. */
function formatDate(date: unknown): string | undefined {
	if (typeof date !== "object" || date === null) return undefined;
	const { year, month, day } = date as Record<string, unknown>;
	if (
		typeof year !== "number" ||
		typeof month !== "number" ||
		typeof day !== "number"
	) {
		return undefined;
	}
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Flattens a `DataPoint` to its type, its time and its measurement.
 *
 * A `DataPoint` is a union of forty optional members, of which exactly one is
 * set, and the set one nests its time under `interval`, `sampleTime` or `date`
 * depending on which it is. Serialising that verbatim spends most of a context
 * window on nulls and envelope — a day of heart-rate samples is thousands of
 * points — and leaves the model to work out the shape before it can answer.
 *
 * The measurement is passed through rather than mapped per type: forty
 * hand-written extractors would be forty things to keep in step with Google,
 * and the field names (`count`, `weightGrams`, `beatsPerMinute`) are already
 * self-describing.
 */
export function summarizeDataPoint(point: DataPoint): DataPointSummary | null {
	const entry = Object.entries(point).find(
		([key, value]) =>
			key !== "name" && typeof value === "object" && value !== null,
	);
	if (!entry) return null;

	const [type, payload] = entry as [string, Record<string, unknown>];
	const { interval, sampleTime, date, ...value } = payload;

	const summary: DataPointSummary = { type, value };
	if (point.name) summary.name = point.name;

	if (interval && typeof interval === "object") {
		const { startTime, endTime } = interval as Record<string, unknown>;
		if (typeof startTime === "string") summary.start = startTime;
		if (typeof endTime === "string") summary.end = endTime;
	} else if (sampleTime && typeof sampleTime === "object") {
		const { physicalTime } = sampleTime as Record<string, unknown>;
		if (typeof physicalTime === "string") summary.start = physicalTime;
	} else if (date) {
		summary.start = formatDate(date);
	}

	return summary;
}

export interface DataTypeDescription {
	id: string;
	/** How the point is timed, which is what a caller can filter on. */
	shape: string;
	/** The schema behind it, for anyone reading Google's reference. */
	schema: string;
}

/**
 * The catalog a client discovers queryable types from.
 *
 * Nothing here marks a type readable or not, and that is on purpose. Whether a
 * type can be read depends on the consent categories the user granted, and
 * Google publishes no mapping from the forty data types onto its twelve
 * categories — inventing one would be guesswork that goes stale silently.
 * `GOOGLE_HEALTH_READ_SCOPES` says which categories are readable *at all*, the
 * granted scopes say which of those this user allowed, and Google's own 403
 * settles any remaining question.
 */
export function describeDataTypes(): DataTypeDescription[] {
	return GOOGLE_HEALTH_DATA_POINT_TYPES.map((type) => ({
		id: type.id,
		shape: type.shape,
		schema: type.schema,
	}));
}

/** `…/auth/googlehealth.sleep.readonly` → `sleep`. */
export function scopeCategory(scope: string): string {
	return scope.split("googlehealth.").at(-1)?.split(".")[0] ?? scope;
}

/** The consent categories this API can read data points from, unabbreviated. */
export function readableCategories(): string[] {
	return GOOGLE_HEALTH_READ_SCOPES.map(scopeCategory);
}
