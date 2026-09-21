import { describe, expect, it } from "vitest";
import { GOOGLE_HEALTH_DATA_POINT_TYPES } from "./google-health-api.gen";
import {
	GOOGLE_HEALTH_ROLLUP_TYPES,
	googleHealthRollupType,
	rollupSlices,
	rollupWindowSize,
} from "./google-health-rollup";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("GOOGLE_HEALTH_ROLLUP_TYPES", () => {
	// Against the real catalog rather than a fixture: the ids here are typed by
	// hand from Google's prose, and this is what catches a typo in one.
	it("names every raw-backed type exactly as the data point catalog does", () => {
		const catalog = new Map(
			GOOGLE_HEALTH_DATA_POINT_TYPES.map((type) => [type.field, type.id]),
		);
		for (const type of GOOGLE_HEALTH_ROLLUP_TYPES) {
			if (type.rollupOnly) {
				expect(catalog.has(type.field)).toBe(false);
			} else {
				expect(catalog.get(type.field)).toBe(type.id);
			}
		}
	});

	it("marks only Google's derived types as rollup-only", () => {
		expect(
			GOOGLE_HEALTH_ROLLUP_TYPES.filter((type) => type.rollupOnly).map(
				(type) => type.id,
			),
		).toEqual(["calories-in-heart-rate-zone", "total-calories"]);
	});

	it("limits the dense types to a fortnight and the rest to ninety days", () => {
		expect(googleHealthRollupType("heart-rate")?.maxRangeDays).toBe(14);
		expect(googleHealthRollupType("total-calories")?.maxRangeDays).toBe(14);
		expect(googleHealthRollupType("steps")?.maxRangeDays).toBe(90);
	});

	it("has no rollup for a type Google does not aggregate", () => {
		expect(googleHealthRollupType("sleep")).toBeUndefined();
		expect(googleHealthRollupType("not-a-type")).toBeUndefined();
	});
});

describe("rollupWindowSize", () => {
	it("renders milliseconds as a google-duration", () => {
		expect(rollupWindowSize(HOUR_MS)).toBe("3600s");
		expect(rollupWindowSize(DAY_MS)).toBe("86400s");
	});
});

describe("rollupSlices", () => {
	const heartRate = googleHealthRollupType("heart-rate");
	if (heartRate === undefined) throw new Error("heart-rate has a rollup");

	it("keeps a range inside the limit as one request", () => {
		expect(
			rollupSlices(heartRate, { fromMs: 0, toMs: 7 * DAY_MS }, DAY_MS),
		).toEqual([{ fromMs: 0, toMs: 7 * DAY_MS }]);
	});

	it("cuts a longer range at the limit, ending the last slice at the range", () => {
		expect(
			rollupSlices(heartRate, { fromMs: 0, toMs: 30 * DAY_MS }, DAY_MS),
		).toEqual([
			{ fromMs: 0, toMs: 14 * DAY_MS },
			{ fromMs: 14 * DAY_MS, toMs: 28 * DAY_MS },
			{ fromMs: 28 * DAY_MS, toMs: 30 * DAY_MS },
		]);
	});

	it("cuts on a window boundary when the limit is not a multiple of the window", () => {
		// A window of 5 days fits twice into 14, so slices are 10 days, not 14.
		const slices = rollupSlices(
			heartRate,
			{ fromMs: 0, toMs: 20 * DAY_MS },
			5 * DAY_MS,
		);
		expect(slices).toEqual([
			{ fromMs: 0, toMs: 10 * DAY_MS },
			{ fromMs: 10 * DAY_MS, toMs: 20 * DAY_MS },
		]);
	});

	it("never produces a slice shorter than one window", () => {
		const slices = rollupSlices(
			heartRate,
			{ fromMs: 0, toMs: 40 * DAY_MS },
			20 * DAY_MS,
		);
		expect(slices).toEqual([
			{ fromMs: 0, toMs: 20 * DAY_MS },
			{ fromMs: 20 * DAY_MS, toMs: 40 * DAY_MS },
		]);
	});

	it("returns nothing for an empty range", () => {
		expect(rollupSlices(heartRate, { fromMs: 5, toMs: 5 }, HOUR_MS)).toEqual(
			[],
		);
	});
});
