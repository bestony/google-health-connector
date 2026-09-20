import { describe, expect, it } from "vitest";
import {
	calendarDayAt,
	dailyTargetWindow,
	fixedOffsetZone,
	isValidTimeZone,
	localDayWindow,
	parseUtcOffsetMinutes,
	resolveTimeZone,
	shiftCalendarDay,
	startOfLocalDay,
} from "./time-window";

const iso = (ms: number) => new Date(ms).toISOString();

describe("isValidTimeZone", () => {
	it("accepts real zones and rejects invented ones", () => {
		expect(isValidTimeZone("Asia/Shanghai")).toBe(true);
		expect(isValidTimeZone("UTC")).toBe(true);
		expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
		expect(isValidTimeZone("")).toBe(false);
	});
});

describe("parseUtcOffsetMinutes", () => {
	it("reads a protobuf Duration in whole minutes", () => {
		expect(parseUtcOffsetMinutes("28800s")).toBe(480);
		expect(parseUtcOffsetMinutes("-18000s")).toBe(-300);
		expect(parseUtcOffsetMinutes("19800s")).toBe(330);
		expect(parseUtcOffsetMinutes(" 3600s ")).toBe(60);
		expect(parseUtcOffsetMinutes("3600.5s")).toBe(60);
	});

	it("returns undefined for anything it cannot read", () => {
		expect(parseUtcOffsetMinutes(undefined)).toBeUndefined();
		expect(parseUtcOffsetMinutes("")).toBeUndefined();
		expect(parseUtcOffsetMinutes("28800")).toBeUndefined();
		expect(parseUtcOffsetMinutes("PT8H")).toBeUndefined();
	});
});

describe("fixedOffsetZone", () => {
	it("inverts the sign, because Etc/GMT+8 is UTC-8", () => {
		expect(fixedOffsetZone(480)).toBe("Etc/GMT-8");
		expect(fixedOffsetZone(-300)).toBe("Etc/GMT+5");
		expect(fixedOffsetZone(0)).toBe("UTC");
	});

	it("refuses an offset it cannot express rather than rounding it", () => {
		// India is +5:30. Rounding to +5 would look correct and be wrong.
		expect(fixedOffsetZone(330)).toBeUndefined();
		expect(fixedOffsetZone(900)).toBeUndefined();
	});

	it("produces zones the runtime actually knows", () => {
		for (const minutes of [-720, -300, 0, 480, 840]) {
			const zone = fixedOffsetZone(minutes);
			expect(zone).toBeDefined();
			expect(isValidTimeZone(zone as string)).toBe(true);
		}
	});
});

describe("resolveTimeZone", () => {
	it("prefers the named zone from settings", () => {
		expect(
			resolveTimeZone({ timeZone: "Asia/Shanghai", utcOffset: "0s" }),
		).toEqual({ source: "settings", timeZone: "Asia/Shanghai" });
	});

	it("falls back to the observed offset when the name is missing or bad", () => {
		expect(resolveTimeZone({ utcOffset: "28800s" })).toEqual({
			source: "observed",
			timeZone: "Etc/GMT-8",
		});
		expect(
			resolveTimeZone({ timeZone: "Nowhere/Fake", utcOffset: "28800s" }),
		).toEqual({ source: "observed", timeZone: "Etc/GMT-8" });
	});

	it("falls back to UTC when nothing is usable", () => {
		const utc = { source: "default", timeZone: "UTC" };
		expect(resolveTimeZone(undefined)).toEqual(utc);
		expect(resolveTimeZone(null)).toEqual(utc);
		expect(resolveTimeZone({})).toEqual(utc);
		expect(resolveTimeZone({ timeZone: "   " })).toEqual(utc);
		// A half-hour offset cannot be expressed, so it is not guessed at.
		expect(resolveTimeZone({ utcOffset: "19800s" })).toEqual(utc);
	});
});

describe("calendarDayAt", () => {
	it("reads the local day, not the UTC one", () => {
		// 20:00 UTC is already the next day in Shanghai (+8).
		const at = new Date("2026-08-09T20:00:00Z");
		expect(calendarDayAt("UTC", at)).toEqual({ day: 9, month: 8, year: 2026 });
		expect(calendarDayAt("Asia/Shanghai", at)).toEqual({
			day: 10,
			month: 8,
			year: 2026,
		});
		// 02:00 UTC is still the previous day in New York (-4 in August).
		const early = new Date("2026-08-09T02:00:00Z");
		expect(calendarDayAt("America/New_York", early)).toEqual({
			day: 8,
			month: 8,
			year: 2026,
		});
	});
});

describe("shiftCalendarDay", () => {
	it("counts on the calendar, across months and years", () => {
		expect(shiftCalendarDay({ day: 1, month: 3, year: 2026 }, -1)).toEqual({
			day: 28,
			month: 2,
			year: 2026,
		});
		expect(shiftCalendarDay({ day: 31, month: 12, year: 2026 }, 1)).toEqual({
			day: 1,
			month: 1,
			year: 2027,
		});
		// 2028 is a leap year.
		expect(shiftCalendarDay({ day: 1, month: 3, year: 2028 }, -1)).toEqual({
			day: 29,
			month: 2,
			year: 2028,
		});
	});
});

describe("startOfLocalDay", () => {
	it("is UTC midnight in UTC", () => {
		expect(iso(startOfLocalDay("UTC", { day: 9, month: 8, year: 2026 }))).toBe(
			"2026-08-09T00:00:00.000Z",
		);
	});

	it("is 16:00 the previous day for UTC+8", () => {
		expect(
			iso(startOfLocalDay("Asia/Shanghai", { day: 9, month: 8, year: 2026 })),
		).toBe("2026-08-08T16:00:00.000Z");
	});

	it("follows the offset across a DST boundary", () => {
		// New York is UTC-5 in January and UTC-4 in July.
		expect(
			iso(
				startOfLocalDay("America/New_York", { day: 15, month: 1, year: 2026 }),
			),
		).toBe("2026-01-15T05:00:00.000Z");
		expect(
			iso(
				startOfLocalDay("America/New_York", { day: 15, month: 7, year: 2026 }),
			),
		).toBe("2026-07-15T04:00:00.000Z");
	});

	it("gets the transition day itself right", () => {
		// US DST starts 2026-03-08: the day begins at 05:00Z, still on EST.
		expect(
			iso(
				startOfLocalDay("America/New_York", { day: 8, month: 3, year: 2026 }),
			),
		).toBe("2026-03-08T05:00:00.000Z");
		// The day after is fully on EDT, so its midnight is an hour earlier in
		// UTC. This is the case the second iteration in `startOfLocalDay` exists
		// for: a single pass reads the offset that applied before the transition.
		expect(
			iso(
				startOfLocalDay("America/New_York", { day: 9, month: 3, year: 2026 }),
			),
		).toBe("2026-03-09T04:00:00.000Z");
		// Southern hemisphere, falling back rather than springing forward.
		expect(
			iso(
				startOfLocalDay("Australia/Sydney", { day: 5, month: 4, year: 2026 }),
			),
		).toBe("2026-04-04T13:00:00.000Z");
	});
});

describe("localDayWindow", () => {
	it("covers exactly one local day", () => {
		const window = localDayWindow(
			"Asia/Shanghai",
			0,
			new Date("2026-08-09T20:00:00Z"),
		);
		// 20:00Z is already 2026-08-10 in Shanghai.
		expect(iso(window.fromMs)).toBe("2026-08-09T16:00:00.000Z");
		expect(iso(window.throughMs)).toBe("2026-08-10T16:00:00.000Z");
		expect(window.throughMs - window.fromMs).toBe(24 * 60 * 60 * 1000);
	});

	it("counts back from the local day, not the UTC one", () => {
		const window = localDayWindow("UTC", -2, new Date("2026-08-09T12:00:00Z"));
		expect(iso(window.fromMs)).toBe("2026-08-07T00:00:00.000Z");
		expect(iso(window.throughMs)).toBe("2026-08-08T00:00:00.000Z");
	});

	it("is 23 or 25 hours long on a DST transition day", () => {
		const hour = 60 * 60 * 1000;
		const spring = localDayWindow(
			"America/New_York",
			0,
			new Date("2026-03-08T12:00:00Z"),
		);
		expect(spring.throughMs - spring.fromMs).toBe(23 * hour);
		const autumn = localDayWindow(
			"America/New_York",
			0,
			new Date("2026-11-01T12:00:00Z"),
		);
		expect(autumn.throughMs - autumn.fromMs).toBe(25 * hour);
	});
});

describe("dailyTargetWindow", () => {
	it("covers D-4 through D-2 with the defaults", () => {
		const window = dailyTargetWindow("UTC", new Date("2026-08-09T05:00:00Z"));
		expect(iso(window.fromMs)).toBe("2026-08-05T00:00:00.000Z");
		// Ends at the start of D-1, so the still-settling day is left alone.
		expect(iso(window.throughMs)).toBe("2026-08-08T00:00:00.000Z");
	});

	it("stops short of yesterday and of today", () => {
		const now = new Date("2026-08-09T05:00:00Z");
		const yesterday = localDayWindow("UTC", -1, now);
		const window = dailyTargetWindow("UTC", now);
		expect(window.throughMs).toBeLessThanOrEqual(yesterday.fromMs);
	});

	it("shifts with the user's zone", () => {
		const window = dailyTargetWindow(
			"Asia/Shanghai",
			new Date("2026-08-09T05:00:00Z"),
		);
		// 05:00Z is 13:00 on the 9th in Shanghai, so D-2 is the 7th, ending at
		// the start of the 8th local time — 16:00Z on the 7th.
		expect(iso(window.fromMs)).toBe("2026-08-04T16:00:00.000Z");
		expect(iso(window.throughMs)).toBe("2026-08-07T16:00:00.000Z");
	});

	it("honours an explicit anchor and lookback", () => {
		const window = dailyTargetWindow(
			"UTC",
			new Date("2026-08-09T05:00:00Z"),
			1,
			1,
		);
		expect(iso(window.fromMs)).toBe("2026-08-08T00:00:00.000Z");
		expect(iso(window.throughMs)).toBe("2026-08-09T00:00:00.000Z");
	});
});
