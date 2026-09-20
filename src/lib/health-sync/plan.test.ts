import { describe, expect, it } from "vitest";
import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import type { SyncCoverage } from "../google-health-sync-window";
import { DAY_MS, ESTIMATED_TASK_MS } from "./config";
import {
	backfillFloorMs,
	type PlanInput,
	type PlannedUser,
	planInvocation,
	rotateAfter,
} from "./plan";

const NOW = new Date("2026-09-20T05:00:00Z");
const TYPES: GoogleHealthDataTypeId[] = ["steps", "sleep"];

/** Fully covered from a year back through the end of the daily window. */
const COVERED: SyncCoverage = {
	fromMs: Date.UTC(2025, 8, 20),
	throughMs: Date.UTC(2026, 8, 19),
};

function user(
	userId: string,
	overrides: Partial<PlannedUser> = {},
): PlannedUser {
	return {
		blocked: new Set(),
		coverage: new Map(),
		dataTypes: TYPES,
		membershipStartMs: undefined,
		timeZone: "UTC",
		userId,
		...overrides,
	};
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
	return {
		backfillDays: 730,
		budgetMs: 60_000,
		cursorUserId: undefined,
		now: NOW,
		users: [user("u1")],
		...overrides,
	};
}

describe("rotateAfter", () => {
	const users = [{ userId: "a" }, { userId: "b" }, { userId: "c" }];

	it("resumes after the cursor, wrapping around", () => {
		expect(rotateAfter(users, "a").map((u) => u.userId)).toEqual([
			"b",
			"c",
			"a",
		]);
		expect(rotateAfter(users, "c").map((u) => u.userId)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("starts from the beginning without a cursor or for an unknown one", () => {
		expect(rotateAfter(users, undefined).map((u) => u.userId)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(rotateAfter(users, "gone").map((u) => u.userId)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(rotateAfter([], "a")).toEqual([]);
	});
});

describe("backfillFloorMs", () => {
	it("uses the configured window when no membership date is known", () => {
		expect(backfillFloorMs(user("u1"), input())).toBe(
			NOW.getTime() - 730 * DAY_MS,
		);
	});

	it("stops at the membership start date when that is more recent", () => {
		const joined = Date.UTC(2026, 0, 1);
		expect(
			backfillFloorMs(user("u1", { membershipStartMs: joined }), input()),
		).toBe(joined);
	});

	it("ignores a membership date older than the configured window", () => {
		const ancient = Date.UTC(2010, 0, 1);
		expect(
			backfillFloorMs(user("u1", { membershipStartMs: ancient }), input()),
		).toBe(NOW.getTime() - 730 * DAY_MS);
	});
});

describe("planInvocation", () => {
	it("emits a daily task per data type for a brand-new user", () => {
		const plan = planInvocation(input());
		const daily = plan.tasks.filter((task) => task.kind === "daily");
		expect(daily.map((task) => task.dataTypeId)).toEqual(["steps", "sleep"]);
		// Nothing is covered yet, so there is no anchor to walk back from.
		expect(plan.tasks.some((task) => task.kind === "backfill")).toBe(false);
		expect(plan.skipped.backfillComplete).toBe(2);
	});

	it("emits backfill once there is a watermark to walk back from", () => {
		const coverage = new Map([
			["steps", { fromMs: Date.UTC(2026, 8, 1), throughMs: COVERED.throughMs }],
		]);
		const plan = planInvocation(input({ users: [user("u1", { coverage })] }));
		const backfill = plan.tasks.filter((task) => task.kind === "backfill");
		expect(backfill).toHaveLength(1);
		expect(backfill[0]?.dataTypeId).toBe("steps");
		expect(backfill[0]?.window.throughMs).toBe(Date.UTC(2026, 8, 1));
	});

	it("skips a data type that is fully up to date", () => {
		const coverage = new Map([["steps", COVERED]]);
		const plan = planInvocation(input({ users: [user("u1", { coverage })] }));
		expect(
			plan.tasks.some(
				(task) => task.kind === "daily" && task.dataTypeId === "steps",
			),
		).toBe(false);
		expect(plan.skipped.upToDate).toBe(1);
	});

	it("skips a blocked data type entirely", () => {
		const plan = planInvocation(
			input({ users: [user("u1", { blocked: new Set(["sleep"]) })] }),
		);
		expect(plan.tasks.every((task) => task.dataTypeId !== "sleep")).toBe(true);
		expect(plan.skipped.blocked).toBe(1);
	});

	it("emits every daily task before any backfill task", () => {
		// The anti-starvation guarantee, stated as a test rather than hoped for.
		const coverage = new Map(
			TYPES.map((type) => [
				type,
				{ fromMs: Date.UTC(2026, 8, 1), throughMs: Date.UTC(2026, 8, 10) },
			]),
		);
		const plan = planInvocation(
			input({
				users: [
					user("u1", { coverage }),
					user("u2", { coverage }),
					user("u3", { coverage }),
				],
			}),
		);

		const firstBackfill = plan.tasks.findIndex(
			(task) => task.kind === "backfill",
		);
		const lastDaily = plan.tasks.reduce(
			(last, task, index) => (task.kind === "daily" ? index : last),
			-1,
		);
		expect(firstBackfill).toBeGreaterThan(lastDaily);
		// And all three users got their daily work.
		expect(
			new Set(
				plan.tasks
					.filter((task) => task.kind === "daily")
					.map((task) => task.userId),
			),
		).toEqual(new Set(["u1", "u2", "u3"]));
	});

	it("drops backfill before it drops daily work when the budget is short", () => {
		const coverage = new Map(
			TYPES.map((type) => [
				type,
				{ fromMs: Date.UTC(2026, 8, 1), throughMs: Date.UTC(2026, 8, 10) },
			]),
		);
		const users = ["u1", "u2", "u3"].map((id) => user(id, { coverage }));
		// Room for the six daily tasks and nothing else.
		const budgetMs = 6 * ESTIMATED_TASK_MS.daily + 1_500;

		const plan = planInvocation(input({ budgetMs, users }));
		expect(plan.tasks.filter((task) => task.kind === "daily")).toHaveLength(6);
		expect(plan.tasks.filter((task) => task.kind === "backfill")).toHaveLength(
			0,
		);
		expect(plan.truncated).toBe(true);
	});

	it("always emits at least one task, however small the budget", () => {
		const plan = planInvocation(input({ budgetMs: 1 }));
		expect(plan.tasks).toHaveLength(1);
		expect(plan.truncated).toBe(true);
	});

	it("reports no truncation when everything fits", () => {
		const plan = planInvocation(input({ budgetMs: 600_000 }));
		expect(plan.truncated).toBe(false);
	});

	it("resumes the rotation after the cursor", () => {
		const users = ["u1", "u2", "u3"].map((id) => user(id));
		const plan = planInvocation(input({ cursorUserId: "u1", users }));
		expect(plan.tasks[0]?.userId).toBe("u2");
	});

	it("advances the cursor to the end of a complete pass", () => {
		const users = ["u1", "u2", "u3"].map((id) => user(id));
		const plan = planInvocation(input({ budgetMs: 600_000, users }));
		expect(plan.nextCursorUserId).toBe("u3");
	});

	it("leaves the cursor on the last user reached when truncated", () => {
		const users = ["u1", "u2", "u3"].map((id) => user(id));
		// Two tasks: both belong to u1, so u2 must not be skipped next time.
		const budgetMs = 2 * ESTIMATED_TASK_MS.daily + 1_500;
		const plan = planInvocation(input({ budgetMs, users }));
		expect(plan.nextCursorUserId).toBe("u1");
	});

	it("plans nothing, and no cursor, for no users", () => {
		const plan = planInvocation(input({ users: [] }));
		expect(plan.tasks).toEqual([]);
		expect(plan.truncated).toBe(false);
		expect(plan.nextCursorUserId).toBeUndefined();
	});

	it("resolves the daily window in the user's own timezone", () => {
		const plan = planInvocation(
			input({ users: [user("u1", { timeZone: "Asia/Shanghai" })] }),
		);
		const daily = plan.tasks.find((task) => task.kind === "daily");
		// 05:00Z is 13:00 on the 20th in Shanghai, so D-2 is the 18th and the
		// window ends when the 19th begins locally — 16:00Z on the 18th, not
		// midnight UTC.
		expect(new Date(daily?.window.throughMs ?? 0).toISOString()).toBe(
			"2026-09-18T16:00:00.000Z",
		);
	});

	it("stops backfill at the floor and reports it complete", () => {
		const floor = NOW.getTime() - 730 * DAY_MS;
		const coverage = new Map(
			TYPES.map((type) => [
				type,
				{ fromMs: floor, throughMs: COVERED.throughMs },
			]),
		);
		const plan = planInvocation(input({ users: [user("u1", { coverage })] }));
		expect(plan.tasks.filter((task) => task.kind === "backfill")).toHaveLength(
			0,
		);
		expect(plan.skipped.backfillComplete).toBe(2);
	});
});
