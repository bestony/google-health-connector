import assert from "node:assert/strict";
import test from "node:test";
import { dataPointTimeFilter } from "./google-health-filter";

const from = new Date("2026-08-09T00:00:00Z");
const to = new Date("2026-08-10T00:00:00Z");

test("session filters use the documented civil start time", () => {
	for (const id of [
		"exercise",
		"hydration-log",
		"irregular-rhythm-notification",
		"nutrition-log",
	] as const) {
		const filterId = id.replaceAll("-", "_");
		assert.equal(
			dataPointTimeFilter(id, { from, to }),
			`${filterId}.interval.civil_start_time >= "2026-08-09T00:00:00" AND ` +
				`${filterId}.interval.civil_start_time < "2026-08-10T00:00:00"`,
		);
	}
});

test("ordinary interval filters continue to use physical start time", () => {
	assert.equal(
		dataPointTimeFilter("steps", { from, to }),
		'steps.interval.start_time >= "2026-08-09T00:00:00.000Z" AND ' +
			'steps.interval.start_time < "2026-08-10T00:00:00.000Z"',
	);
});

test("sleep continues to use physical end time", () => {
	assert.equal(
		dataPointTimeFilter("sleep", { from, to }),
		'sleep.interval.end_time >= "2026-08-09T00:00:00.000Z" AND ' +
			'sleep.interval.end_time < "2026-08-10T00:00:00.000Z"',
	);
});

test("electrocardiogram continues to reject an upper bound", () => {
	assert.throws(
		() => dataPointTimeFilter("electrocardiogram", { from, to }),
		/does not support an upper time bound/,
	);
});
