import assert from "node:assert/strict";
import test from "node:test";
import type { DataPoint } from "../google-health-api.gen";
import { summarizeDataPoint } from "./health";

test("summarizeDataPoint selects the measurement instead of dataSource", () => {
	const point: DataPoint = {
		dataSource: {
			platform: "FITBIT",
			recordingMethod: "PASSIVELY_MEASURED",
		},
		steps: {
			count: "1234",
			interval: {
				startTime: "2026-08-09T00:00:00Z",
				endTime: "2026-08-09T00:15:00Z",
			},
		},
	};

	assert.deepEqual(summarizeDataPoint(point), {
		type: "steps",
		start: "2026-08-09T00:00:00Z",
		end: "2026-08-09T00:15:00Z",
		value: { count: "1234" },
	});
});

test("summarizeDataPoint preserves daily measurement values", () => {
	const point: DataPoint = {
		dataSource: { platform: "FITBIT" },
		dailyRestingHeartRate: {
			beatsPerMinute: "62",
			date: { year: 2026, month: 8, day: 9 },
		},
	};

	assert.deepEqual(summarizeDataPoint(point), {
		type: "dailyRestingHeartRate",
		start: "2026-08-09",
		value: { beatsPerMinute: "62" },
	});
});

test("summarizeDataPoint rejects an envelope without a measurement", () => {
	const point: DataPoint = {
		name: "users/example/dataTypes/sleep/dataPoints/example",
		dataSource: { platform: "FITBIT" },
	};

	assert.equal(summarizeDataPoint(point), null);
});
