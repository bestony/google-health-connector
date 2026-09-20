import { describe, expect, it } from "vitest";
import { GOOGLE_HEALTH_DATA_POINT_TYPES } from "../google-health-api.gen";
import { dataPointTimeFilter } from "../google-health-filter";
import {
	acceptsUpperBound,
	planTimeWindow,
	withinPlannedWindow,
} from "./data-window";

const WINDOW = {
	fromMs: Date.UTC(2026, 7, 9),
	throughMs: Date.UTC(2026, 7, 10),
};

describe("planTimeWindow", () => {
	it("passes a two-sided range through for an ordinary type", () => {
		expect(planTimeWindow("steps", WINDOW)).toEqual({
			filterBefore: undefined,
			from: new Date(WINDOW.fromMs),
			to: new Date(WINDOW.throughMs),
		});
	});

	it("drops the upper bound for an electrocardiogram and hands it back", () => {
		const request = planTimeWindow("electrocardiogram", WINDOW);
		expect(request.to).toBeUndefined();
		expect(request.from).toEqual(new Date(WINDOW.fromMs));
		expect(request.filterBefore).toEqual(new Date(WINDOW.throughMs));
	});

	it("leaves sleep alone, because the filter already anchors it on end time", () => {
		const request = planTimeWindow("sleep", WINDOW);
		expect(request.to).toEqual(new Date(WINDOW.throughMs));
		expect(request.filterBefore).toBeUndefined();
		expect(dataPointTimeFilter("sleep", request)).toContain(
			"sleep.interval.end_time",
		);
	});

	it("rejects an id that is not in the catalog", () => {
		expect(() => planTimeWindow("not-a-type" as never, WINDOW)).toThrow(
			/Unknown Google Health data type/,
		);
	});

	it("produces a request the filter accepts for every catalog type", () => {
		// The real guarantee this module exists for: sweeping all forty types over
		// one window must never throw. Driven off the generated catalog so a
		// regeneration that adds a lower-bound-only type fails here.
		for (const type of GOOGLE_HEALTH_DATA_POINT_TYPES) {
			const request = planTimeWindow(type.id, WINDOW);
			expect(() => dataPointTimeFilter(type.id, request)).not.toThrow();
		}
	});

	it("is the only type needing client-side trimming today", () => {
		const trimmed = GOOGLE_HEALTH_DATA_POINT_TYPES.filter(
			(type) => !acceptsUpperBound(type.id),
		).map((type) => type.id);
		expect(trimmed).toEqual(["electrocardiogram"]);
	});
});

describe("withinPlannedWindow", () => {
	const points = [
		{ observedAtMs: WINDOW.fromMs },
		{ observedAtMs: WINDOW.throughMs - 1 },
		{ observedAtMs: WINDOW.throughMs },
		{ observedAtMs: WINDOW.throughMs + 60_000 },
	];

	it("trims points past the window when the request could not bound it", () => {
		const request = planTimeWindow("electrocardiogram", WINDOW);
		expect(withinPlannedWindow(points, request)).toEqual([
			{ observedAtMs: WINDOW.fromMs },
			{ observedAtMs: WINDOW.throughMs - 1 },
		]);
	});

	it("is a pass-through when Google already applied the upper bound", () => {
		const request = planTimeWindow("steps", WINDOW);
		expect(withinPlannedWindow(points, request)).toEqual(points);
	});
});
