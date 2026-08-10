import { describe, expect, it } from "vitest";
import type { DataPoint } from "../google-health-api.gen";
import {
	clampHistoryWindow,
	describeDataTypes,
	readableCategories,
	scopeCategory,
	summarizeDataPoint,
} from "./health";

describe("summarizeDataPoint", () => {
	it("selects the measurement instead of dataSource", () => {
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

		expect(summarizeDataPoint(point)).toEqual({
			type: "steps",
			start: "2026-08-09T00:00:00Z",
			end: "2026-08-09T00:15:00Z",
			value: { count: "1234" },
		});
	});

	it("preserves daily measurement values", () => {
		const point: DataPoint = {
			dataSource: { platform: "FITBIT" },
			dailyRestingHeartRate: {
				beatsPerMinute: "62",
				date: { year: 2026, month: 8, day: 9 },
			},
		};

		expect(summarizeDataPoint(point)).toEqual({
			type: "dailyRestingHeartRate",
			start: "2026-08-09",
			value: { beatsPerMinute: "62" },
		});
	});

	it("rejects an envelope without a measurement", () => {
		const point: DataPoint = {
			name: "users/example/dataTypes/sleep/dataPoints/example",
			dataSource: { platform: "FITBIT" },
		};

		expect(summarizeDataPoint(point)).toBeNull();
	});

	it("includes an identifiable name and sample time", () => {
		const point: DataPoint = {
			name: "users/me/dataTypes/heart-rate/dataPoints/1",
			heartRate: {
				beatsPerMinute: "72",
				sampleTime: { physicalTime: "2026-08-09T00:00:00Z" },
			},
		};
		expect(summarizeDataPoint(point)).toEqual({
			type: "heartRate",
			name: "users/me/dataTypes/heart-rate/dataPoints/1",
			start: "2026-08-09T00:00:00Z",
			value: { beatsPerMinute: "72" },
		});
	});

	it("handles intervals and incomplete sample times", () => {
		const intervalPoint: DataPoint = {
			exercise: {
				activeDuration: "1s",
				interval: { endTime: "2026-08-09T01:00:00Z" },
			},
		};
		expect(summarizeDataPoint(intervalPoint)).toEqual({
			type: "exercise",
			end: "2026-08-09T01:00:00Z",
			value: { activeDuration: "1s" },
		});
		const samplePoint: DataPoint = {
			heartRate: {
				beatsPerMinute: "70",
				sampleTime: { physicalTime: 123 as never },
			},
		};
		expect(summarizeDataPoint(samplePoint)).toEqual({
			type: "heartRate",
			value: { beatsPerMinute: "70" },
		});
	});

	it("ignores malformed time payloads while preserving measurements", () => {
		const point: DataPoint = {
			dailyRestingHeartRate: {
				beatsPerMinute: "60",
				date: { year: "2026" as never, month: 8, day: 9 },
			},
		};
		expect(summarizeDataPoint(point)).toEqual({
			type: "dailyRestingHeartRate",
			value: { beatsPerMinute: "60" },
		});
		const nullDatePoint: DataPoint = {
			dailyRestingHeartRate: { beatsPerMinute: "60", date: null as never },
		};
		expect(summarizeDataPoint(nullDatePoint)).toEqual({
			type: "dailyRestingHeartRate",
			value: { beatsPerMinute: "60" },
		});
	});
});

describe("health tool helpers", () => {
	it("clamps old windows and leaves recent or missing starts alone", () => {
		const now = new Date("2026-08-10T00:00:00Z");
		const old = new Date("2026-01-01T00:00:00Z");
		const recent = new Date("2026-08-09T00:00:00Z");
		expect(clampHistoryWindow({ from: old, to: now }, now, 90)).toMatchObject({
			clamped: true,
			to: now,
			limitDays: 90,
		});
		expect(clampHistoryWindow({ from: recent }, now, 90)).toMatchObject({
			from: recent,
			clamped: false,
		});
		expect(clampHistoryWindow({}, now, 0)).toMatchObject({
			from: now,
			clamped: false,
		});
	});

	it("describes the generated catalog and consent categories", () => {
		const types = describeDataTypes();
		expect(types.length).toBeGreaterThan(10);
		expect(types[0]).toEqual(
			expect.objectContaining({
				id: expect.any(String),
				shape: expect.any(String),
			}),
		);
		expect(
			scopeCategory(
				"https://www.googleapis.com/auth/googlehealth.sleep.readonly",
			),
		).toBe("sleep");
		expect(scopeCategory("plain-scope")).toBe("plain-scope");
		expect(readableCategories()).toContain("sleep");
	});
});
