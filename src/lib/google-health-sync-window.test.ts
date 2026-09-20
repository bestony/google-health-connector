import { describe, expect, it } from "vitest";
import {
	coversWindow,
	isBackfillComplete,
	isPermanentSyncFailure,
	MAX_CONSECUTIVE_FAILURES,
	mergeCoverage,
	nextBackfillWindow,
	nextForwardWindow,
	type SyncCoverage,
	shouldDisableSync,
} from "./google-health-sync-window";

const DAY = 24 * 60 * 60 * 1000;
const EMPTY: SyncCoverage = { fromMs: null, throughMs: null };

/** `day(3)` is three days after the epoch — readable without date arithmetic. */
const day = (n: number) => n * DAY;

describe("mergeCoverage", () => {
	it("seeds empty coverage from the first window", () => {
		expect(mergeCoverage(EMPTY, { fromMs: day(3), throughMs: day(5) })).toEqual(
			{
				ok: true,
				coverage: { fromMs: day(3), throughMs: day(5) },
			},
		);
	});

	it("extends upwards and downwards", () => {
		const coverage = { fromMs: day(3), throughMs: day(5) };
		expect(
			mergeCoverage(coverage, { fromMs: day(5), throughMs: day(7) }),
		).toEqual({ ok: true, coverage: { fromMs: day(3), throughMs: day(7) } });
		expect(
			mergeCoverage(coverage, { fromMs: day(1), throughMs: day(3) }),
		).toEqual({ ok: true, coverage: { fromMs: day(1), throughMs: day(5) } });
	});

	it("absorbs an overlapping or fully contained window", () => {
		const coverage = { fromMs: day(3), throughMs: day(9) };
		expect(
			mergeCoverage(coverage, { fromMs: day(4), throughMs: day(6) }),
		).toEqual({ ok: true, coverage });
		expect(
			mergeCoverage(coverage, { fromMs: day(8), throughMs: day(12) }),
		).toEqual({ ok: true, coverage: { fromMs: day(3), throughMs: day(12) } });
	});

	it("refuses a window that would leave a hole", () => {
		const coverage = { fromMs: day(3), throughMs: day(5) };
		expect(
			mergeCoverage(coverage, { fromMs: day(7), throughMs: day(9) }),
		).toEqual({ ok: false, reason: "gap" });
		expect(
			mergeCoverage(coverage, { fromMs: day(0), throughMs: day(2) }),
		).toEqual({ ok: false, reason: "gap" });
	});

	it("refuses an empty or inverted window before anything else", () => {
		expect(mergeCoverage(EMPTY, { fromMs: day(5), throughMs: day(5) })).toEqual(
			{ ok: false, reason: "empty" },
		);
		expect(mergeCoverage(EMPTY, { fromMs: day(5), throughMs: day(3) })).toEqual(
			{ ok: false, reason: "empty" },
		);
	});
});

describe("nextForwardWindow", () => {
	const target = { fromMs: day(10), throughMs: day(13) };

	it("fetches the whole target when nothing is covered", () => {
		expect(nextForwardWindow(EMPTY, target, day(30))).toEqual(target);
	});

	it("clamps an uncovered target to the chunk size, keeping the newest end", () => {
		expect(nextForwardWindow(EMPTY, target, day(1))).toEqual({
			fromMs: day(12),
			throughMs: day(13),
		});
	});

	it("re-reads the lookback window even where it is already covered", () => {
		// Coverage is fresh through D-1 but the target reaches back three days:
		// late device backfill means those days are worth reading again, and the
		// upsert makes it free.
		const coverage = { fromMs: day(1), throughMs: day(12) };
		expect(nextForwardWindow(coverage, target, day(30))).toEqual({
			fromMs: day(10),
			throughMs: day(13),
		});
	});

	it("returns null when coverage already reaches the target", () => {
		expect(
			nextForwardWindow(
				{ fromMs: day(1), throughMs: day(13) },
				target,
				day(30),
			),
		).toBeNull();
		expect(
			nextForwardWindow(
				{ fromMs: day(1), throughMs: day(99) },
				target,
				day(30),
			),
		).toBeNull();
	});

	it("walks a long absence forward in contiguous bounded steps", () => {
		// Eight months away: each step must stay adjacent to the watermark, or
		// mergeCoverage would refuse it.
		let coverage: SyncCoverage = { fromMs: day(0), throughMs: day(2) };
		const far = { fromMs: day(240), throughMs: day(243) };

		for (let step = 0; step < 5; step += 1) {
			const window = nextForwardWindow(coverage, far, day(30));
			expect(window).not.toBeNull();
			if (window === null) return;
			const merged = mergeCoverage(coverage, window);
			expect(merged.ok).toBe(true);
			if (!merged.ok) return;
			coverage = merged.coverage;
		}

		expect(coverage.throughMs).toBe(day(152));
	});

	it("returns null for an empty target", () => {
		expect(
			nextForwardWindow(EMPTY, { fromMs: day(5), throughMs: day(5) }, day(30)),
		).toBeNull();
	});
});

describe("nextBackfillWindow", () => {
	it("walks back one chunk at a time from the lower watermark", () => {
		const coverage = { fromMs: day(100), throughMs: day(110) };
		expect(nextBackfillWindow(coverage, day(0), day(14))).toEqual({
			fromMs: day(86),
			throughMs: day(100),
		});
	});

	it("stops exactly at the floor", () => {
		const coverage = { fromMs: day(10), throughMs: day(110) };
		expect(nextBackfillWindow(coverage, day(0), day(14))).toEqual({
			fromMs: day(0),
			throughMs: day(10),
		});
	});

	it("returns null at or below the floor", () => {
		expect(
			nextBackfillWindow(
				{ fromMs: day(0), throughMs: day(5) },
				day(0),
				day(14),
			),
		).toBeNull();
		expect(
			nextBackfillWindow(
				{ fromMs: day(-3), throughMs: day(5) },
				day(0),
				day(14),
			),
		).toBeNull();
	});

	it("returns null without an anchor to walk back from", () => {
		expect(nextBackfillWindow(EMPTY, day(0), day(14))).toBeNull();
	});
});

describe("isBackfillComplete", () => {
	it("is derived from the lower watermark alone", () => {
		expect(isBackfillComplete(EMPTY, day(0))).toBe(false);
		expect(
			isBackfillComplete({ fromMs: day(1), throughMs: day(5) }, day(0)),
		).toBe(false);
		expect(
			isBackfillComplete({ fromMs: day(0), throughMs: day(5) }, day(0)),
		).toBe(true);
	});
});

describe("coversWindow", () => {
	const coverage = { fromMs: day(10), throughMs: day(20) };

	it("requires total containment", () => {
		expect(
			coversWindow(coverage, { fromMs: day(12), throughMs: day(18) }),
		).toBe(true);
		expect(
			coversWindow(coverage, { fromMs: day(10), throughMs: day(20) }),
		).toBe(true);
		expect(coversWindow(coverage, { fromMs: day(9), throughMs: day(18) })).toBe(
			false,
		);
		expect(
			coversWindow(coverage, { fromMs: day(12), throughMs: day(21) }),
		).toBe(false);
	});

	it("covers nothing while the watermarks are unset", () => {
		expect(coversWindow(EMPTY, { fromMs: day(12), throughMs: day(13) })).toBe(
			false,
		);
		expect(
			coversWindow(
				{ fromMs: day(1), throughMs: null },
				{
					fromMs: day(2),
					throughMs: day(3),
				},
			),
		).toBe(false);
	});
});

describe("failure policy", () => {
	it("treats only 403 and 404 as permanent", () => {
		expect(isPermanentSyncFailure(403)).toBe(true);
		expect(isPermanentSyncFailure(404)).toBe(true);
		expect(isPermanentSyncFailure(401)).toBe(false);
		expect(isPermanentSyncFailure(400)).toBe(false);
		expect(isPermanentSyncFailure(429)).toBe(false);
		expect(isPermanentSyncFailure(503)).toBe(false);
	});

	it("disables on a permanent status or a long enough losing streak", () => {
		expect(shouldDisableSync(403, 0)).toBe(true);
		expect(shouldDisableSync(500, 0)).toBe(false);
		expect(shouldDisableSync(500, MAX_CONSECUTIVE_FAILURES - 1)).toBe(false);
		expect(shouldDisableSync(500, MAX_CONSECUTIVE_FAILURES)).toBe(true);
	});
});
