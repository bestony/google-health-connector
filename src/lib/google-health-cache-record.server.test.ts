import { describe, expect, it } from "vitest";
import type { DataPoint } from "./google-health-api.gen";
import {
	canonicalJson,
	healthContentHash,
	healthPointIdentity,
	healthSourceKey,
	healthSyncStateId,
	toHealthCacheRecord,
} from "./google-health-cache-record.server";

const SYNCED_AT = new Date("2026-09-20T05:00:00Z");
const USER = "user_1";

const context = (
	dataType: Parameters<typeof toHealthCacheRecord>[1]["dataType"],
) => ({
	dataType,
	syncedAt: SYNCED_AT,
	userId: USER,
});

const stepsPoint = (count: string): DataPoint => ({
	dataSource: { platform: "FITBIT", recordingMethod: "PASSIVELY_MEASURED" },
	steps: {
		count,
		interval: {
			endTime: "2026-08-09T00:15:00Z",
			startTime: "2026-08-09T00:00:00Z",
		},
	},
});

describe("canonicalJson", () => {
	it("is independent of key order", () => {
		expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
		expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
	});

	it("drops undefined members but keeps null", () => {
		expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
	});

	it("sorts nested objects and preserves array order", () => {
		expect(canonicalJson({ list: [{ z: 1, y: 2 }, 3] })).toBe(
			'{"list":[{"y":2,"z":1},3]}',
		);
	});

	it("renders primitives and a bare undefined", () => {
		expect(canonicalJson(undefined)).toBe("null");
		expect(canonicalJson(null)).toBe("null");
		expect(canonicalJson("x")).toBe('"x"');
		expect(canonicalJson(7)).toBe("7");
	});
});

describe("healthSourceKey", () => {
	it("is null without a source and stable with one", () => {
		expect(healthSourceKey(undefined)).toBeNull();
		expect(healthSourceKey(null)).toBeNull();
		const first = healthSourceKey({ platform: "FITBIT", version: "1" });
		expect(first).toBe(healthSourceKey({ version: "1", platform: "FITBIT" }));
		expect(first).not.toBe(healthSourceKey({ platform: "HEALTH_CONNECT" }));
	});
});

describe("healthPointIdentity", () => {
	const base = {
		dataType: "steps",
		grain: "point" as const,
		observedAtMs: 100,
		observedEndMs: 200,
		resourceName: null,
		sourceKey: "abc",
	};

	it("prefers Google's own name when there is one", () => {
		expect(healthPointIdentity({ ...base, resourceName: "users/me/x/1" })).toBe(
			"name:users/me/x/1",
		);
	});

	it("ignores time and source once a name is present", () => {
		const named = { ...base, resourceName: "users/me/x/1" };
		expect(healthPointIdentity(named)).toBe(
			healthPointIdentity({ ...named, observedAtMs: 999, sourceKey: "zzz" }),
		);
	});

	it("falls back to time and source, not to the measurement", () => {
		expect(healthPointIdentity(base)).toBe(healthPointIdentity({ ...base }));
		expect(healthPointIdentity(base)).not.toBe(
			healthPointIdentity({ ...base, observedAtMs: 101 }),
		);
		expect(healthPointIdentity(base)).not.toBe(
			healthPointIdentity({ ...base, sourceKey: "def" }),
		);
	});
});

describe("healthSyncStateId", () => {
	it("is deterministic and separates users from data types", () => {
		expect(healthSyncStateId(USER, "steps")).toBe(
			healthSyncStateId(USER, "steps"),
		);
		expect(healthSyncStateId(USER, "steps")).not.toBe(
			healthSyncStateId(USER, "sleep"),
		);
		// Length-prefixed parts: "ab"+"c" must not collide with "a"+"bc".
		expect(healthSyncStateId("ab", "c")).not.toBe(healthSyncStateId("a", "bc"));
	});
});

describe("toHealthCacheRecord", () => {
	it("maps an interval point, keeping the raw time envelope", () => {
		const mapping = toHealthCacheRecord(stepsPoint("1234"), context("steps"));
		expect(mapping.ok).toBe(true);
		if (!mapping.ok) return;

		expect(mapping.record).toMatchObject({
			dataType: "steps",
			grain: "point",
			observedAtMs: Date.parse("2026-08-09T00:00:00Z"),
			observedEndMs: Date.parse("2026-08-09T00:15:00Z"),
			observedTime: {
				interval: {
					endTime: "2026-08-09T00:15:00Z",
					startTime: "2026-08-09T00:00:00Z",
				},
			},
			resourceName: null,
			syncedAt: SYNCED_AT,
			timeShape: "interval",
			userId: USER,
			value: { count: "1234" },
		});
	});

	it("gives the same id twice, so a re-read is an upsert", () => {
		const first = toHealthCacheRecord(stepsPoint("1234"), context("steps"));
		const second = toHealthCacheRecord(stepsPoint("1234"), context("steps"));
		expect(first.ok && second.ok && first.record.id).toBe(
			second.ok ? second.record.id : "",
		);
	});

	it("keeps the id but changes the hash when only the measurement moved", () => {
		const before = toHealthCacheRecord(stepsPoint("1234"), context("steps"));
		const after = toHealthCacheRecord(stepsPoint("1300"), context("steps"));
		expect(before.ok && after.ok).toBe(true);
		if (!(before.ok && after.ok)) return;

		expect(after.record.id).toBe(before.record.id);
		expect(after.record.contentHash).not.toBe(before.record.contentHash);
	});

	it("separates two devices reporting the same interval", () => {
		const watch = stepsPoint("1234");
		const phone: DataPoint = {
			...watch,
			dataSource: { platform: "HEALTH_CONNECT" },
		};
		const first = toHealthCacheRecord(watch, context("steps"));
		const second = toHealthCacheRecord(phone, context("steps"));
		expect(first.ok && second.ok).toBe(true);
		if (!(first.ok && second.ok)) return;

		expect(second.record.id).not.toBe(first.record.id);
		expect(second.record.sourceKey).not.toBe(first.record.sourceKey);
	});

	it("separates two users", () => {
		const mine = toHealthCacheRecord(stepsPoint("1234"), context("steps"));
		const theirs = toHealthCacheRecord(stepsPoint("1234"), {
			dataType: "steps",
			syncedAt: SYNCED_AT,
			userId: "user_2",
		});
		expect(mine.ok && theirs.ok).toBe(true);
		if (!(mine.ok && theirs.ok)) return;
		expect(theirs.record.id).not.toBe(mine.record.id);
	});

	it("spans a whole UTC day for a daily summary", () => {
		const point: DataPoint = {
			dailyRestingHeartRate: {
				beatsPerMinute: "62",
				date: { day: 9, month: 8, year: 2026 },
			},
			dataSource: { platform: "FITBIT" },
		};
		const mapping = toHealthCacheRecord(
			point,
			context("daily-resting-heart-rate"),
		);
		expect(mapping.ok).toBe(true);
		if (!mapping.ok) return;

		expect(mapping.record.observedAtMs).toBe(Date.parse("2026-08-09"));
		expect(mapping.record.observedEndMs).toBe(Date.parse("2026-08-10"));
		expect(mapping.record.timeShape).toBe("daily");
		expect(mapping.record.observedTime).toEqual({
			date: { day: 9, month: 8, year: 2026 },
		});
	});

	it("gives a sample zero duration and carries its name", () => {
		const point: DataPoint = {
			heartRate: {
				beatsPerMinute: "72",
				sampleTime: { physicalTime: "2026-08-09T00:00:00Z" },
			},
			name: "users/me/dataTypes/heart-rate/dataPoints/1",
		};
		const mapping = toHealthCacheRecord(point, context("heart-rate"));
		expect(mapping.ok).toBe(true);
		if (!mapping.ok) return;

		expect(mapping.record.observedAtMs).toBe(mapping.record.observedEndMs);
		expect(mapping.record.resourceName).toBe(
			"users/me/dataTypes/heart-rate/dataPoints/1",
		);
		expect(mapping.record.source).toBeNull();
		expect(mapping.record.sourceKey).toBeNull();
	});

	it("rejects an envelope carrying no measurement", () => {
		expect(
			toHealthCacheRecord(
				{ dataSource: { platform: "FITBIT" }, name: "users/me/x/1" },
				context("steps"),
			),
		).toEqual({ ok: false, reason: "not-a-data-point" });
	});

	it("rejects a payload of a different type than was asked for", () => {
		expect(toHealthCacheRecord(stepsPoint("1"), context("sleep"))).toEqual({
			ok: false,
			reason: "wrong-data-type",
		});
	});

	it("rejects a point it cannot place on a timeline", () => {
		const endOnly: DataPoint = {
			exercise: {
				activeDuration: "1s",
				interval: { endTime: "2026-08-09T01:00:00Z" },
			},
		};
		expect(toHealthCacheRecord(endOnly, context("exercise"))).toEqual({
			ok: false,
			reason: "untimed",
		});

		const unparsable: DataPoint = {
			steps: { count: "1", interval: { startTime: "not-a-date" } },
		};
		expect(toHealthCacheRecord(unparsable, context("steps"))).toEqual({
			ok: false,
			reason: "untimed",
		});
	});

	it("rejects an interval that ends before it starts", () => {
		const inverted: DataPoint = {
			steps: {
				count: "1",
				interval: {
					endTime: "2026-08-09T00:00:00Z",
					startTime: "2026-08-09T00:15:00Z",
				},
			},
		};
		expect(toHealthCacheRecord(inverted, context("steps"))).toEqual({
			ok: false,
			reason: "inverted-interval",
		});
	});

	it("falls back to a zero-length interval when only the end is unparsable", () => {
		const point: DataPoint = {
			steps: {
				count: "1",
				interval: { endTime: "nope", startTime: "2026-08-09T00:00:00Z" },
			},
		};
		const mapping = toHealthCacheRecord(point, context("steps"));
		expect(mapping.ok).toBe(true);
		if (!mapping.ok) return;
		expect(mapping.record.observedEndMs).toBe(mapping.record.observedAtMs);
	});

	it("keeps the civil time and offsets that the summary drops", () => {
		const point: DataPoint = {
			steps: {
				count: "1234",
				interval: {
					civilStartTime: { date: { day: 9, month: 8, year: 2026 } },
					endTime: "2026-08-09T00:15:00Z",
					startTime: "2026-08-09T00:00:00Z",
					startUtcOffset: "28800s",
				},
			},
		};
		const mapping = toHealthCacheRecord(point, context("steps"));
		expect(mapping.ok).toBe(true);
		if (!mapping.ok) return;

		expect(mapping.record.observedTime).toEqual({
			interval: {
				civilStartTime: { date: { day: 9, month: 8, year: 2026 } },
				endTime: "2026-08-09T00:15:00Z",
				startTime: "2026-08-09T00:00:00Z",
				startUtcOffset: "28800s",
			},
		});
		// The summary keeps only the measurement, which is why the envelope has to
		// be stored separately for the point to be reconstructable.
		expect(mapping.record.value).toEqual({ count: "1234" });
	});
});

describe("healthContentHash", () => {
	it("ignores member order and reacts to every stored part", () => {
		const base = { observedTime: { a: 1 }, source: { b: 2 }, value: { c: 3 } };
		expect(healthContentHash(base)).toBe(
			healthContentHash({
				source: { b: 2 },
				value: { c: 3 },
				observedTime: { a: 1 },
			}),
		);
		expect(healthContentHash({ ...base, value: { c: 4 } })).not.toBe(
			healthContentHash(base),
		);
		expect(healthContentHash({ ...base, source: null })).not.toBe(
			healthContentHash(base),
		);
	});
});
