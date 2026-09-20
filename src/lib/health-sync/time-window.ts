import type { SyncWindow } from "../google-health-sync-window";
import { DAILY_ANCHOR_DAYS, DAILY_LOOKBACK_DAYS } from "./config";

/**
 * Local calendar days, resolved in the user's own timezone.
 *
 * "Two days ago" is a statement about the user's calendar, not about UTC. For
 * someone in Asia/Shanghai a UTC-anchored window is eight hours out of step,
 * which puts a third of every night's sleep in the wrong bucket and truncates
 * the first hours of the day at each edge. Daily summaries are worse: Google
 * dates them by the user's local day, so a UTC window can miss one entirely or
 * claim to have covered a day it only half read.
 *
 * Built on `Intl.DateTimeFormat`'s `timeZone` option, which Node's full ICU
 * supports out of the box — no dependency, and it tracks tzdata with the
 * runtime rather than with this repository.
 *
 * Pure, so the day arithmetic that decides what gets fetched is unit-tested
 * against real zones and real DST transitions rather than trusted.
 */

/** Where a resolved timezone came from, for the dashboard and for diagnosis. */
export type TimeZoneSource = "settings" | "observed" | "default";

export interface ResolvedTimeZone {
	/** An IANA zone, or a fixed-offset `Etc/GMT±N` when only an offset is known. */
	timeZone: string;
	source: TimeZoneSource;
}

/** A protobuf Duration, as `Settings.utcOffset` sends it: `"28800s"`. */
const DURATION_SECONDS = /^(-?\d+(?:\.\d+)?)s$/;

/** The zone used when nothing better is known. */
export const DEFAULT_TIME_ZONE = "UTC";

/** Whether the runtime recognises this zone. */
export function isValidTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Parses Google's `Settings.utcOffset`, a protobuf Duration like `"28800s"`.
 *
 * Returns whole minutes, because that is the finest granularity any real zone
 * uses and it keeps the `Etc/GMT` fallback below honest about what it can
 * represent.
 */
export function parseUtcOffsetMinutes(
	offset: string | undefined,
): number | undefined {
	if (offset === undefined) return undefined;
	const match = DURATION_SECONDS.exec(offset.trim());
	if (match === null) return undefined;
	const seconds = Number(match[1]);
	if (!Number.isFinite(seconds)) return undefined;
	return Math.round(seconds / 60);
}

/**
 * A fixed-offset zone for an offset we observed but cannot name.
 *
 * `Etc/GMT+8` is UTC*minus* 8 — the sign is inverted, which is a POSIX
 * convention and a reliable source of off-by-sixteen-hours bugs, so the
 * inversion happens here and exactly once.
 *
 * Only whole hours can be expressed this way, so an offset like India's +5:30
 * falls back to UTC rather than being silently rounded to +5: a wrong day
 * boundary is worse than an admittedly-unknown one, because the wrong one looks
 * correct.
 */
export function fixedOffsetZone(offsetMinutes: number): string | undefined {
	if (offsetMinutes % 60 !== 0) return undefined;
	const hours = offsetMinutes / 60;
	if (Math.abs(hours) > 14) return undefined;
	if (hours === 0) return "UTC";
	return `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
}

/**
 * The user's timezone, from the best source available.
 *
 * `Settings.timeZone` is an IANA name and is authoritative, but reading it
 * needs the `settings.readonly` consent category, which is separate from every
 * health category and which many users will not have granted. `Settings.utcOffset`
 * is the same call's weaker answer. UTC is the honest last resort — and
 * `source` records which one it was, so a support question about a day boundary
 * has an answer.
 */
export function resolveTimeZone(
	settings: { timeZone?: string; utcOffset?: string } | null | undefined,
): ResolvedTimeZone {
	const named = settings?.timeZone?.trim();
	if (named !== undefined && named !== "" && isValidTimeZone(named)) {
		return { source: "settings", timeZone: named };
	}

	const offsetMinutes = parseUtcOffsetMinutes(settings?.utcOffset);
	if (offsetMinutes !== undefined) {
		const zone = fixedOffsetZone(offsetMinutes);
		if (zone !== undefined && isValidTimeZone(zone)) {
			return { source: "observed", timeZone: zone };
		}
	}

	return { source: "default", timeZone: DEFAULT_TIME_ZONE };
}

interface CalendarDay {
	year: number;
	month: number;
	day: number;
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
	const cached = PART_FORMATTERS.get(zone);
	if (cached !== undefined) return cached;
	const formatter = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		month: "2-digit",
		second: "2-digit",
		timeZone: zone,
		year: "numeric",
	});
	PART_FORMATTERS.set(zone, formatter);
	return formatter;
}

interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/**
 * The six fields the formatter was asked for, read back as numbers.
 *
 * Seeded with defaults rather than assembled from optional lookups, so callers
 * get a complete value and none of them has to carry a fallback for a part the
 * formatter is guaranteed to emit. `formatToParts` interleaves `literal` parts
 * for the separators, which is the one thing filtered out here.
 */
function partsAt(zone: string, at: Date): ZonedParts {
	const parts: ZonedParts = {
		day: 1,
		hour: 0,
		minute: 0,
		month: 1,
		second: 0,
		year: 1970,
	};
	for (const part of formatterFor(zone).formatToParts(at)) {
		if (part.type in parts) {
			parts[part.type as keyof ZonedParts] = Number(part.value);
		}
	}
	return parts;
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 *
 * Derived by formatting the instant in the zone and reading the result back as
 * though it were UTC; the difference is the offset. This is the standard trick,
 * and it is used rather than a hardcoded table because it follows whatever
 * tzdata the runtime ships.
 */
function offsetMsAt(zone: string, at: Date): number {
	const parts = partsAt(zone, at);
	const asUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	// Instants carry milliseconds the formatter does not, so drop them from both
	// sides rather than letting them leak into the offset.
	return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar day an instant falls on, in the given zone. */
export function calendarDayAt(zone: string, at: Date): CalendarDay {
	const { day, month, year } = partsAt(zone, at);
	return { day, month, year };
}

/**
 * The instant at which a local calendar day begins, as epoch milliseconds.
 *
 * Solved by iteration rather than in one step: the offset to apply depends on
 * the instant, and the instant is what is being computed. Two passes settle it
 * for every real zone, including the day a DST transition lands on — the first
 * pass lands within an hour of the answer, and the second reads the offset that
 * actually applies there.
 *
 * On a spring-forward day where local midnight does not exist (Lord Howe, and
 * some zones historically), this lands on the instant the day does begin, which
 * is the useful answer rather than a thrown error.
 */
export function startOfLocalDay(zone: string, day: CalendarDay): number {
	const naive = Date.UTC(day.year, day.month - 1, day.day);
	let instant = naive - offsetMsAt(zone, new Date(naive));
	instant = naive - offsetMsAt(zone, new Date(instant));
	return instant;
}

/** The calendar day `offset` days from `day`, counting on the calendar. */
export function shiftCalendarDay(
	day: CalendarDay,
	offset: number,
): CalendarDay {
	const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + offset));
	return {
		day: shifted.getUTCDate(),
		month: shifted.getUTCMonth() + 1,
		year: shifted.getUTCFullYear(),
	};
}

/**
 * One local day as a half-open window of absolute time.
 *
 * `dayOffset` counts back from the local day `now` falls on: `0` is today,
 * `-2` is the day before yesterday.
 */
export function localDayWindow(
	zone: string,
	dayOffset: number,
	now: Date,
): SyncWindow {
	const day = shiftCalendarDay(calendarDayAt(zone, now), dayOffset);
	return {
		fromMs: startOfLocalDay(zone, day),
		throughMs: startOfLocalDay(zone, shiftCalendarDay(day, 1)),
	};
}

/**
 * The window the daily sync wants fresh: the last `DAILY_LOOKBACK_DAYS` local
 * days, ending with D-`DAILY_ANCHOR_DAYS`.
 *
 * With the defaults that is D-4 through D-2 inclusive, so the returned window
 * ends at the start of D-1 — a day that is still settling, and deliberately
 * left to a later run.
 */
export function dailyTargetWindow(
	zone: string,
	now: Date,
	anchorDays: number = DAILY_ANCHOR_DAYS,
	lookbackDays: number = DAILY_LOOKBACK_DAYS,
): SyncWindow {
	const today = calendarDayAt(zone, now);
	const lastCovered = shiftCalendarDay(today, -anchorDays);
	const firstCovered = shiftCalendarDay(lastCovered, -(lookbackDays - 1));
	return {
		fromMs: startOfLocalDay(zone, firstCovered),
		throughMs: startOfLocalDay(zone, shiftCalendarDay(lastCovered, 1)),
	};
}
