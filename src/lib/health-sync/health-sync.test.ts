import { describe, expect, it } from "vitest";
import {
	BACKOFF_CAP_MS,
	BLOCK_RETRY_DAYS,
	DAY_MS,
	ERROR_COOLDOWN_MS,
} from "./config";
import { extractCronCredential, secretsMatch } from "./credential.server";
import {
	isKnownDataType,
	parseGrantedScopes,
	plannedDataTypes,
	readableGrantedScopes,
	selectEligibleUsers,
} from "./eligibility";
import {
	classifyFailure,
	isPermanentStatus,
	isRetryableStatus,
	nextRetryDelayMs,
	restAfterFailure,
	retryDelayFor,
} from "./failure";
import { emptyCounters, nextHintFor, outcomeFor, summarizeRun } from "./report";

const READ = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
const WRITE = "https://www.googleapis.com/auth/googlehealth.sleep.writeonly";
const ACTIVITY =
	"https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

describe("parseGrantedScopes", () => {
	it("splits on whitespace and commas, dropping blanks", () => {
		expect(parseGrantedScopes(` ${READ}  ${WRITE} `)).toEqual([READ, WRITE]);
		expect(parseGrantedScopes(`${READ},${WRITE}`)).toEqual([READ, WRITE]);
		expect(parseGrantedScopes(null)).toEqual([]);
		expect(parseGrantedScopes(undefined)).toEqual([]);
		expect(parseGrantedScopes("   ")).toEqual([]);
	});
});

describe("readableGrantedScopes", () => {
	it("keeps only scopes this API can actually read with", () => {
		expect(readableGrantedScopes(`${READ} ${WRITE} openid`)).toEqual([READ]);
		// Nutrition and friends are write-only in this API version, so a grant of
		// one buys nothing readable.
		expect(
			readableGrantedScopes(
				"https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
			),
		).toEqual([]);
	});
});

describe("selectEligibleUsers", () => {
	it("keeps users with a readable grant and drops the rest", () => {
		expect(
			selectEligibleUsers([
				{ scope: READ, userId: "u1" },
				{ scope: WRITE, userId: "u2" },
				{ scope: null, userId: "u3" },
				{ userId: "u4" },
			]),
		).toEqual([{ grantedReadScopes: [READ], userId: "u1" }]);
	});

	it("unions the grants of a user with two linked accounts", () => {
		expect(
			selectEligibleUsers([
				{ scope: READ, userId: "u1" },
				{ scope: ACTIVITY, userId: "u1" },
			]),
		).toEqual([{ grantedReadScopes: [ACTIVITY, READ].sort(), userId: "u1" }]);
	});

	it("orders by user id, so the rotation cursor is stable", () => {
		const users = selectEligibleUsers([
			{ scope: READ, userId: "u3" },
			{ scope: READ, userId: "u1" },
			{ scope: READ, userId: "u2" },
		]);
		expect(users.map((user) => user.userId)).toEqual(["u1", "u2", "u3"]);
	});
});

describe("plannedDataTypes", () => {
	it("probes the whole catalog by default", () => {
		const types = plannedDataTypes();
		expect(types.length).toBeGreaterThan(30);
		expect(types).toContain("steps");
		expect(types).toContain("sleep");
	});

	it("narrows to an allowlist, ignoring unknown entries", () => {
		expect(plannedDataTypes(["sleep", "steps"])).toEqual(["sleep", "steps"]);
		expect(plannedDataTypes(["steps", "nonsense" as never])).toEqual(["steps"]);
	});

	it("keeps catalog order rather than allowlist order", () => {
		// `sleep` sorts after `steps` in the allowlist above but before it in the
		// catalog; the catalog wins so two operators writing the list differently
		// get the same sync.
		expect(plannedDataTypes(["steps", "sleep"])).toEqual(["sleep", "steps"]);
	});
});

describe("isKnownDataType", () => {
	it("recognises catalog ids only", () => {
		expect(isKnownDataType("steps")).toBe(true);
		expect(isKnownDataType("stepCount")).toBe(false);
		expect(isKnownDataType("")).toBe(false);
	});
});

describe("classifyFailure", () => {
	const apiError = (status: number, googleStatus?: string) =>
		Object.assign(new Error(`Google Health API ${status}`), {
			googleStatus,
			status,
		});

	it("reads an authorization failure as the user's to fix", () => {
		const failure = classifyFailure(
			Object.assign(new Error("No usable Google authorization."), {
				missingScopes: [READ],
			}),
		);
		expect(failure.kind).toBe("auth");
		expect(failure.abortUser).toBe(true);
		expect(failure.missingScopes).toEqual([READ]);
	});

	it("reads 403 and 404 as permanent for the pair, not the user", () => {
		for (const status of [403, 404]) {
			const failure = classifyFailure(apiError(status, "PERMISSION_DENIED"));
			expect(failure.kind).toBe("permanent");
			expect(failure.abortUser).toBe(false);
			expect(failure.status).toBe(status);
			expect(failure.code).toBe("PERMISSION_DENIED");
		}
	});

	it("aborts the whole user on a 429 but not on a 500", () => {
		// Quota is charged against the user's token or the project, so the other
		// thirty-nine data types are going to get the same answer.
		expect(classifyFailure(apiError(429)).abortUser).toBe(true);
		expect(classifyFailure(apiError(503)).abortUser).toBe(false);
		expect(classifyFailure(apiError(503)).kind).toBe("retryable");
	});

	it("treats a 400 as unknown rather than permanent", () => {
		// A filter this app built wrongly is fixed by a deploy, not by the user.
		expect(classifyFailure(apiError(400)).kind).toBe("unknown");
	});

	it("survives anything that is not an error at all", () => {
		expect(classifyFailure("boom")).toMatchObject({
			kind: "unknown",
			message: "boom",
			status: undefined,
		});
		expect(classifyFailure(null).kind).toBe("unknown");
		expect(classifyFailure(undefined).kind).toBe("unknown");
	});
});

describe("status predicates", () => {
	it("separates permanent from retryable, with 401 in neither", () => {
		expect(isPermanentStatus(403)).toBe(true);
		expect(isPermanentStatus(401)).toBe(false);
		expect(isRetryableStatus(429)).toBe(true);
		expect(isRetryableStatus(500)).toBe(true);
		expect(isRetryableStatus(404)).toBe(false);
	});
});

describe("nextRetryDelayMs", () => {
	it("grows exponentially and is capped", () => {
		const atMax = () => 0.999_999;
		expect(nextRetryDelayMs(1, atMax)).toBe(499);
		expect(nextRetryDelayMs(2, atMax)).toBe(999);
		expect(nextRetryDelayMs(3, atMax)).toBe(1_999);
		expect(nextRetryDelayMs(20, atMax)).toBe(BACKOFF_CAP_MS - 1);
	});

	it("uses full jitter, so a delay can be near zero", () => {
		// Equal jitter would leave a floor that keeps retrying clients in phase.
		expect(nextRetryDelayMs(5, () => 0)).toBe(0);
	});

	it("treats attempt 0 like the first attempt", () => {
		expect(nextRetryDelayMs(0, () => 0.5)).toBe(nextRetryDelayMs(1, () => 0.5));
	});
});

describe("retryDelayFor", () => {
	it("prefers Google's own Retry-After", () => {
		const error = Object.assign(new Error("429"), {
			retryAfterMs: 2_000,
			status: 429,
		});
		const failure = classifyFailure(error);
		expect(retryDelayFor(failure, 1, error, () => 0.9)).toBe(2_000);
	});

	it("caps a hint that is longer than the invocation can wait", () => {
		const error = Object.assign(new Error("429"), {
			retryAfterMs: 600_000,
			status: 429,
		});
		expect(retryDelayFor(classifyFailure(error), 1, error, () => 0)).toBe(
			BACKOFF_CAP_MS,
		);
	});

	it("falls back to the jittered curve without a hint", () => {
		const error = Object.assign(new Error("500"), { status: 500 });
		expect(retryDelayFor(classifyFailure(error), 2, error, () => 0.5)).toBe(
			nextRetryDelayMs(2, () => 0.5),
		);
	});
});

describe("restAfterFailure", () => {
	const now = new Date("2026-09-20T05:00:00Z");

	it("rests a permanent failure for a week, so a later grant takes effect", () => {
		expect(restAfterFailure(classifyFailure({ status: 403 }), now)).toEqual({
			disabledAt: now,
			retryAfter: new Date(now.getTime() + BLOCK_RETRY_DAYS * DAY_MS),
		});
	});

	it("rests everything else for an hour", () => {
		expect(restAfterFailure(classifyFailure({ status: 500 }), now)).toEqual({
			disabledAt: now,
			retryAfter: new Date(now.getTime() + ERROR_COOLDOWN_MS),
		});
	});
});

describe("extractCronCredential", () => {
	it("reads a bearer token, case- and space-insensitively", () => {
		expect(
			extractCronCredential(new Headers({ authorization: "Bearer abc" })),
		).toBe("abc");
		expect(
			extractCronCredential(new Headers({ authorization: "bearer  abc  " })),
		).toBe("abc");
	});

	it("returns undefined for anything else", () => {
		expect(extractCronCredential(new Headers())).toBeUndefined();
		expect(
			extractCronCredential(new Headers({ authorization: "Basic abc" })),
		).toBeUndefined();
		expect(
			extractCronCredential(new Headers({ authorization: "Bearer" })),
		).toBeUndefined();
		expect(
			extractCronCredential(new Headers({ authorization: "Bearer    " })),
		).toBeUndefined();
	});
});

describe("secretsMatch", () => {
	it("accepts only an exact match", () => {
		expect(secretsMatch("s3cret", "s3cret")).toBe(true);
		expect(secretsMatch("s3cret", "s3creT")).toBe(false);
	});

	it("rejects a length mismatch without throwing", () => {
		// The hash-then-compare is what makes this safe; timingSafeEqual on the
		// raw strings would throw here.
		expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
	});

	it("rejects missing or empty secrets", () => {
		expect(secretsMatch(undefined, "s")).toBe(false);
		expect(secretsMatch("s", undefined)).toBe(false);
		expect(secretsMatch("", "")).toBe(false);
	});
});

describe("run report", () => {
	const startedAt = new Date("2026-09-20T05:00:00Z");
	const finishedAt = new Date("2026-09-20T05:00:08Z");

	it("carries the counters into both shapes", () => {
		const summary = summarizeRun({
			budgetMs: 8_000,
			counters: {
				...emptyCounters(),
				pointsInserted: 12,
				tasksPlanned: 4,
				tasksRan: 4,
				usersTouched: 1,
			},
			finishedAt,
			moreWork: false,
			outcome: "completed",
			runId: "r1",
			startedAt,
			trigger: "cron",
		});

		expect(summary.durationMs).toBe(8_000);
		expect(summary.points).toEqual({ inserted: 12, updated: 0 });
		expect(summary.tasks).toEqual({ planned: 4, ran: 4 });
		expect(summary.error).toBeUndefined();
	});

	it("includes an error only when there was one", () => {
		const summary = summarizeRun({
			budgetMs: 8_000,
			counters: emptyCounters(),
			error: "boom",
			finishedAt,
			moreWork: false,
			outcome: "failed",
			runId: "r1",
			startedAt,
			trigger: "cron",
		});
		expect(summary.error).toBe("boom");
	});

	it("names the next step for every outcome", () => {
		expect(nextHintFor("skipped_locked", false)).toMatch(/already running/i);
		expect(nextHintFor("skipped_disabled", false)).toMatch(
			/HEALTH_SYNC_ENABLED/,
		);
		expect(nextHintFor("lost_lease", false)).toMatch(/HEALTH_SYNC_BUDGET_MS/);
		expect(nextHintFor("failed", false)).toMatch(/health:sync/);
		expect(nextHintFor("idle", false)).toMatch(/up to date/i);
		expect(nextHintFor("partial", true)).toMatch(/Call again/);
		expect(nextHintFor("completed", false)).toMatch(/Everything owed/);
	});
});

describe("outcomeFor", () => {
	it("tells a quiet night from a busy one", () => {
		expect(outcomeFor(0, false)).toBe("idle");
		expect(outcomeFor(4, false)).toBe("completed");
		expect(outcomeFor(4, true)).toBe("partial");
	});
});
