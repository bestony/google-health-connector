import { describe, expect, it } from "vitest";
import {
	dataPointsParent,
	dataPointTimeFilter,
	googleHealthDataType,
} from "./google-health-filter";

const from = new Date("2026-08-09T00:00:00Z");
const to = new Date("2026-08-10T00:00:00Z");

describe("dataPointTimeFilter", () => {
	it("uses the documented civil start time for sessions", () => {
		for (const id of [
			"exercise",
			"hydration-log",
			"irregular-rhythm-notification",
			"nutrition-log",
		] as const) {
			const filterId = id.replaceAll("-", "_");
			expect(dataPointTimeFilter(id, { from, to })).toBe(
				`${filterId}.interval.civil_start_time >= "2026-08-09T00:00:00" AND ` +
					`${filterId}.interval.civil_start_time < "2026-08-10T00:00:00"`,
			);
		}
	});

	it("continues to use physical start time for ordinary intervals", () => {
		expect(dataPointTimeFilter("steps", { from, to })).toBe(
			'steps.interval.start_time >= "2026-08-09T00:00:00.000Z" AND ' +
				'steps.interval.start_time < "2026-08-10T00:00:00.000Z"',
		);
	});

	it("continues to use physical end time for sleep", () => {
		expect(dataPointTimeFilter("sleep", { from, to })).toBe(
			'sleep.interval.end_time >= "2026-08-09T00:00:00.000Z" AND ' +
				'sleep.interval.end_time < "2026-08-10T00:00:00.000Z"',
		);
	});

	it("rejects an upper bound for electrocardiogram", () => {
		expect(() =>
			dataPointTimeFilter("electrocardiogram", { from, to }),
		).toThrow(/does not support an upper time bound/);
	});

	it("supports sample and daily shapes and open-ended ranges", () => {
		expect(dataPointTimeFilter("heart-rate", { from })).toBe(
			'heart_rate.sample_time.physical_time >= "2026-08-09T00:00:00.000Z"',
		);
		expect(dataPointTimeFilter("daily-resting-heart-rate", { to })).toBe(
			'daily_resting_heart_rate.date < "2026-08-10"',
		);
		expect(dataPointTimeFilter("steps", {})).toBeUndefined();
	});

	it("rejects unknown and inverted ranges", () => {
		expect(() => googleHealthDataType("not-a-type" as never)).toThrow(
			/Unknown Google Health data type/,
		);
		expect(() => dataPointTimeFilter("steps", { from: to, to: from })).toThrow(
			/starts after it ends/,
		);
	});

	it("builds user-specific data point parents", () => {
		expect(dataPointsParent("steps")).toBe("users/me/dataTypes/steps");
		expect(dataPointsParent("sleep", "user-123")).toBe(
			"users/user-123/dataTypes/sleep",
		);
	});
});
