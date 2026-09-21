import { describe, expect, it } from "vitest";
import {
	type AggregatablePoint,
	aggregatePoints,
	alignAggregateWindow,
	formatWithOffset,
	numericLeaves,
	reconciliationSlotMs,
	startAggregateWindowAt,
	summarizeRollupPoint,
} from "./aggregate";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const at = (iso: string) => Date.parse(iso);

describe("alignAggregateWindow", () => {
	it("widens a range outward to whole UTC days", () => {
		const window = alignAggregateWindow({
			fromMs: at("2026-09-14T09:14:00Z"),
			granularity: "day",
			toMs: at("2026-09-16T00:00:01Z"),
			utcOffsetMinutes: 0,
		});
		expect(new Date(window.fromMs).toISOString()).toBe(
			"2026-09-14T00:00:00.000Z",
		);
		expect(new Date(window.toMs).toISOString()).toBe(
			"2026-09-17T00:00:00.000Z",
		);
		expect(window.buckets).toBe(3);
		expect(window.bucketMs).toBe(DAY_MS);
	});

	it("leaves an already aligned range alone", () => {
		const window = alignAggregateWindow({
			fromMs: at("2026-09-14T03:00:00Z"),
			granularity: "hour",
			toMs: at("2026-09-14T06:00:00Z"),
			utcOffsetMinutes: 0,
		});
		expect(window.fromMs).toBe(at("2026-09-14T03:00:00Z"));
		expect(window.toMs).toBe(at("2026-09-14T06:00:00Z"));
		expect(window.buckets).toBe(3);
	});

	it("draws days on the caller's clock, east and west of UTC", () => {
		const east = alignAggregateWindow({
			fromMs: at("2026-09-14T10:00:00+08:00"),
			granularity: "day",
			toMs: at("2026-09-14T11:00:00+08:00"),
			utcOffsetMinutes: 480,
		});
		expect(east.fromMs).toBe(at("2026-09-14T00:00:00+08:00"));
		expect(east.toMs).toBe(at("2026-09-15T00:00:00+08:00"));

		const west = alignAggregateWindow({
			fromMs: at("2026-09-14T22:00:00-05:00"),
			granularity: "day",
			toMs: at("2026-09-14T23:00:00-05:00"),
			utcOffsetMinutes: -300,
		});
		expect(west.fromMs).toBe(at("2026-09-14T00:00:00-05:00"));
		expect(west.toMs).toBe(at("2026-09-15T00:00:00-05:00"));
	});

	it("aligns hours to a half-hour offset", () => {
		const window = alignAggregateWindow({
			fromMs: at("2026-09-14T10:10:00+05:30"),
			granularity: "hour",
			toMs: at("2026-09-14T10:20:00+05:30"),
			utcOffsetMinutes: 330,
		});
		expect(window.fromMs).toBe(at("2026-09-14T10:00:00+05:30"));
		expect(window.buckets).toBe(1);
	});
});

describe("startAggregateWindowAt", () => {
	const window = alignAggregateWindow({
		fromMs: at("2026-09-01T00:00:00Z"),
		granularity: "day",
		toMs: at("2026-09-11T00:00:00Z"),
		utcOffsetMinutes: 0,
	});

	it("returns the window untouched when it starts late enough", () => {
		expect(startAggregateWindowAt(window, at("2026-08-01T00:00:00Z"))).toBe(
			window,
		);
	});

	it("moves the start forward to the next whole bucket", () => {
		const moved = startAggregateWindowAt(window, at("2026-09-03T15:00:00Z"));
		expect(moved.fromMs).toBe(at("2026-09-04T00:00:00Z"));
		expect(moved.buckets).toBe(7);
		expect(moved.toMs).toBe(window.toMs);
	});

	it("leaves no buckets when the whole window is too old", () => {
		expect(
			startAggregateWindowAt(window, at("2026-10-01T00:00:00Z")).buckets,
		).toBe(0);
	});
});

describe("formatWithOffset", () => {
	it("writes UTC with a Z", () => {
		expect(formatWithOffset(at("2026-09-14T00:00:00Z"), 0)).toBe(
			"2026-09-14T00:00:00Z",
		);
	});

	it("writes the caller's wall clock and offset", () => {
		const instant = at("2026-09-14T00:00:00Z");
		expect(formatWithOffset(instant, 480 * MINUTE_MS)).toBe(
			"2026-09-14T08:00:00+08:00",
		);
		expect(formatWithOffset(instant, -210 * MINUTE_MS)).toBe(
			"2026-09-13T20:30:00-03:30",
		);
	});
});

describe("numericLeaves", () => {
	it("reads numbers, int64 strings and durations, and nothing else", () => {
		expect(
			numericLeaves({
				count: "1200",
				duration: "90.5s",
				kcal: 12.5,
				label: "walk",
				notANumber: Number.NaN,
				notes: "12 apples",
				stages: [{ minutes: "5" }],
				summary: { minutesAsleep: "420", nested: { deep: -1 } },
				type: null,
			}),
		).toEqual([
			["count", 1200],
			["duration", 90.5],
			["kcal", 12.5],
			["summary.minutesAsleep", 420],
			["summary.nested.deep", -1],
		]);
	});
});

describe("reconciliationSlotMs", () => {
	it("trusts one source per hour for samples and intervals", () => {
		expect(
			reconciliationSlotMs(
				{ collection: "interval", shape: "interval" },
				DAY_MS,
			),
		).toBe(HOUR_MS);
		expect(
			reconciliationSlotMs({ collection: "sample", shape: "sample" }, HOUR_MS),
		).toBe(HOUR_MS);
	});

	it("trusts one source per day for sessions and daily summaries", () => {
		expect(
			reconciliationSlotMs(
				{ collection: "session", shape: "interval" },
				DAY_MS,
			),
		).toBe(DAY_MS);
		expect(
			reconciliationSlotMs({ collection: "daily", shape: "daily" }, DAY_MS),
		).toBe(DAY_MS);
	});

	it("never exceeds the bucket", () => {
		expect(
			reconciliationSlotMs(
				{ collection: "session", shape: "interval" },
				HOUR_MS,
			),
		).toBe(HOUR_MS);
	});
});

describe("aggregatePoints", () => {
	const day = alignAggregateWindow({
		fromMs: at("2026-09-14T00:00:00Z"),
		granularity: "day",
		toMs: at("2026-09-16T00:00:00Z"),
		utcOffsetMinutes: 0,
	});

	const steps = (
		iso: string,
		count: number,
		sourceKey: string | null = "watch",
	): AggregatablePoint => ({
		atMs: at(iso),
		sourceKey,
		value: { count: String(count) },
	});

	it("sums, averages and bounds each field per bucket, omitting empty ones", () => {
		const result = aggregatePoints(
			[
				steps("2026-09-14T08:00:00Z", 100),
				steps("2026-09-14T08:01:00Z", 300),
				steps("2026-09-14T20:00:00Z", 50),
			],
			day,
			HOUR_MS,
		);
		expect(result).toEqual({
			buckets: [
				{
					end: "2026-09-15T00:00:00Z",
					points: 3,
					start: "2026-09-14T00:00:00Z",
					values: { count: { avg: 150, max: 300, min: 50, sum: 450 } },
				},
			],
			pointsInWindow: 3,
			sources: 1,
		});
	});

	it("counts one source per slot, so two devices do not double a total", () => {
		const result = aggregatePoints(
			[
				// 08:00 — both devices saw the walk; the watch saw more of it.
				steps("2026-09-14T08:00:00Z", 100, "watch"),
				steps("2026-09-14T08:30:00Z", 100, "watch"),
				steps("2026-09-14T08:10:00Z", 190, "phone"),
				// 13:00 — the watch was charging, and the phone's steps still count.
				steps("2026-09-14T13:00:00Z", 40, "phone"),
			],
			day,
			HOUR_MS,
		);
		expect(result.sources).toBe(2);
		expect(result.pointsInWindow).toBe(4);
		expect(result.buckets).toHaveLength(1);
		expect(result.buckets[0]?.points).toBe(3);
		expect(result.buckets[0]?.values.count?.sum).toBe(240);
	});

	it("breaks a tie between sources the same way every time", () => {
		const forward = aggregatePoints(
			[
				steps("2026-09-14T08:00:00Z", 1, "b"),
				steps("2026-09-14T08:00:00Z", 2, "a"),
			],
			day,
			HOUR_MS,
		);
		const reversed = aggregatePoints(
			[
				steps("2026-09-14T08:00:00Z", 2, "a"),
				steps("2026-09-14T08:00:00Z", 1, "b"),
			],
			day,
			HOUR_MS,
		);
		expect(forward.buckets[0]?.values.count?.sum).toBe(2);
		expect(reversed.buckets[0]?.values.count?.sum).toBe(2);
	});

	it("treats points with no source as one source of their own", () => {
		const result = aggregatePoints(
			[
				steps("2026-09-14T08:00:00Z", 5, null),
				steps("2026-09-14T08:05:00Z", 5, null),
			],
			day,
			HOUR_MS,
		);
		expect(result.sources).toBe(1);
		expect(result.buckets[0]?.values.count?.sum).toBe(10);
	});

	it("drops points outside the window, the end being exclusive", () => {
		const result = aggregatePoints(
			[
				steps("2026-09-13T23:59:59Z", 1),
				steps("2026-09-16T00:00:00Z", 1),
				steps("2026-09-15T23:59:59Z", 7),
			],
			day,
			HOUR_MS,
		);
		expect(result.pointsInWindow).toBe(1);
		expect(result.buckets).toEqual([
			expect.objectContaining({ start: "2026-09-15T00:00:00Z", points: 1 }),
		]);
	});

	it("orders buckets by time whatever order the points arrive in", () => {
		const result = aggregatePoints(
			[steps("2026-09-15T10:00:00Z", 1), steps("2026-09-14T10:00:00Z", 1)],
			day,
			HOUR_MS,
		);
		expect(result.buckets.map((bucket) => bucket.start)).toEqual([
			"2026-09-14T00:00:00Z",
			"2026-09-15T00:00:00Z",
		]);
	});

	it("places a point on the caller's day, not the UTC one", () => {
		const local = alignAggregateWindow({
			fromMs: at("2026-09-14T00:00:00+08:00"),
			granularity: "day",
			toMs: at("2026-09-16T00:00:00+08:00"),
			utcOffsetMinutes: 480,
		});
		// 23:30 UTC on the 14th is already 07:30 on the 15th in UTC+8.
		const result = aggregatePoints(
			[steps("2026-09-14T23:30:00Z", 9)],
			local,
			HOUR_MS,
		);
		expect(result.buckets).toEqual([
			expect.objectContaining({
				end: "2026-09-16T00:00:00+08:00",
				start: "2026-09-15T00:00:00+08:00",
			}),
		]);
	});

	it("averages over points rather than over slots, and rounds the noise off", () => {
		const hour = alignAggregateWindow({
			fromMs: at("2026-09-14T08:00:00Z"),
			granularity: "hour",
			toMs: at("2026-09-14T09:00:00Z"),
			utcOffsetMinutes: 0,
		});
		const result = aggregatePoints(
			[
				{
					atMs: at("2026-09-14T08:00:00Z"),
					sourceKey: "w",
					value: { kcal: 0.1 },
				},
				{
					atMs: at("2026-09-14T08:10:00Z"),
					sourceKey: "w",
					value: { kcal: 0.2 },
				},
			],
			hour,
			HOUR_MS,
		);
		expect(result.buckets[0]?.values.kcal).toEqual({
			avg: 0.15,
			max: 0.2,
			min: 0.1,
			sum: 0.3,
		});
	});

	it("merges min and max across the slots of a bucket", () => {
		const result = aggregatePoints(
			[
				{
					atMs: at("2026-09-14T03:00:00Z"),
					sourceKey: "w",
					value: { beatsPerMinute: "48" },
				},
				{
					atMs: at("2026-09-14T18:00:00Z"),
					sourceKey: "w",
					value: { beatsPerMinute: "151" },
				},
				{
					atMs: at("2026-09-14T19:00:00Z"),
					sourceKey: "w",
					value: { beatsPerMinute: "101", confidence: 1 },
				},
			],
			day,
			HOUR_MS,
		);
		expect(result.buckets[0]?.values).toEqual({
			beatsPerMinute: { avg: 100, max: 151, min: 48, sum: 300 },
			confidence: { avg: 1, max: 1, min: 1, sum: 1 },
		});
	});
});

describe("summarizeRollupPoint", () => {
	it("passes Google's aggregate through on the caller's clock", () => {
		expect(
			summarizeRollupPoint(
				{
					endTime: "2026-09-15T00:00:00Z",
					startTime: "2026-09-14T00:00:00Z",
					steps: { countSum: "8123" },
				},
				"steps",
				0,
			),
		).toEqual({
			end: "2026-09-15T00:00:00Z",
			start: "2026-09-14T00:00:00Z",
			values: { countSum: "8123" },
		});
	});

	it("drops a window with nothing in it", () => {
		const window = {
			endTime: "2026-09-15T00:00:00Z",
			startTime: "2026-09-14T00:00:00Z",
		};
		expect(summarizeRollupPoint(window, "steps", 0)).toBeNull();
		expect(
			summarizeRollupPoint({ ...window, steps: {} }, "steps", 0),
		).toBeNull();
	});

	it("drops a window it cannot place in time", () => {
		expect(
			summarizeRollupPoint({ steps: { countSum: "1" } }, "steps", 0),
		).toBeNull();
		expect(
			summarizeRollupPoint(
				{ startTime: "2026-09-14T00:00:00Z", steps: { countSum: "1" } },
				"steps",
				0,
			),
		).toBeNull();
	});
});
