import {
	BACKOFF_BASE_MS,
	BACKOFF_CAP_MS,
	BLOCK_RETRY_DAYS,
	DAY_MS,
	ERROR_COOLDOWN_MS,
} from "./config";

/**
 * What a failed fetch means, and what to do about it.
 *
 * Four outcomes, and the distinction that matters is not severity but *who can
 * fix it*: a 429 is Google asking for a pause, a 403 is the user not having
 * granted something, and an authorization error is the user needing to
 * reconnect. Retrying helps only the first.
 *
 * Classification is structural rather than `instanceof`. `GoogleHealthApiError`
 * and `GoogleHealthAuthorizationError` live in `.server.ts` modules that pull
 * in better-auth and the whole token stack; importing them here to narrow a
 * type would drag that into every unit test of this file and would make a
 * module whose entire job is a decision table depend on an HTTP client. The
 * shapes checked below are the public fields of those two classes, and the
 * executor's tests round-trip real instances through them.
 */

export type FailureKind =
	/** Google may succeed if asked again: 429 and 5xx. */
	| "retryable"
	/** Permanent for this (user, data type) until the user changes something. */
	| "permanent"
	/** Permanent for this user this run: they must reconnect Google. */
	| "auth"
	/** Unrecognised. Treated as retryable once, then rested. */
	| "unknown";

export interface ClassifiedFailure {
	kind: FailureKind;
	/** HTTP status, when the failure came from Google. */
	status: number | undefined;
	/** Google's canonical status name, e.g. `PERMISSION_DENIED`. */
	code: string | undefined;
	message: string;
	/** Scopes the user never granted, when that is what went wrong. */
	missingScopes: readonly string[];
	/**
	 * Whether this failure means the rest of the user's run is pointless.
	 *
	 * True for an authorization failure, and true for a 429: quota is charged
	 * against the user's token or the whole project, so the other thirty-nine
	 * data types are going to get the same answer. Continuing is thirty-nine
	 * guaranteed failures and thirty-nine seconds of budget spent proving it.
	 */
	abortUser: boolean;
}

interface ApiErrorShape {
	status: number;
	googleStatus?: string;
	retryAfterMs?: number;
}

interface AuthErrorShape {
	missingScopes: readonly string[];
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asApiError(error: unknown): ApiErrorShape | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const candidate = error as Partial<ApiErrorShape>;
	return typeof candidate.status === "number"
		? (candidate as ApiErrorShape)
		: undefined;
}

function asAuthError(error: unknown): AuthErrorShape | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const candidate = error as Partial<AuthErrorShape>;
	return Array.isArray(candidate.missingScopes)
		? (candidate as AuthErrorShape)
		: undefined;
}

/**
 * Whether a status means "stop asking for this pair".
 *
 * 403 is a consent category the user never granted; 404 is a data type this
 * account has no collection for. Both are answers about the account rather than
 * the request. 401 is deliberately absent — better-auth refreshes the token —
 * and so is 400, which means this app built a filter wrongly and a deploy fixes
 * it.
 */
export function isPermanentStatus(status: number): boolean {
	return status === 403 || status === 404;
}

/** Whether asking again could plausibly work. */
export function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

export function classifyFailure(error: unknown): ClassifiedFailure {
	const auth = asAuthError(error);
	if (auth !== undefined) {
		return {
			abortUser: true,
			code: "UNAUTHORIZED",
			kind: "auth",
			message: messageOf(error),
			missingScopes: auth.missingScopes,
			status: undefined,
		};
	}

	const api = asApiError(error);
	if (api === undefined) {
		return {
			abortUser: false,
			code: undefined,
			kind: "unknown",
			message: messageOf(error),
			missingScopes: [],
			status: undefined,
		};
	}

	const shared = {
		code: api.googleStatus,
		message: messageOf(error),
		missingScopes: [] as readonly string[],
		status: api.status,
	};

	if (isPermanentStatus(api.status)) {
		return { ...shared, abortUser: false, kind: "permanent" };
	}
	if (isRetryableStatus(api.status)) {
		return { ...shared, abortUser: api.status === 429, kind: "retryable" };
	}
	return { ...shared, abortUser: false, kind: "unknown" };
}

/**
 * How long to wait before attempt number `attempt` (1-based).
 *
 * Exponential with **full** jitter: the delay is a uniform draw from
 * `[0, min(cap, base * 2^n))` rather than a fixed step. Equal jitter would
 * leave a floor that keeps a fleet of retrying clients partly in phase, which
 * is the thundering herd the backoff exists to avoid.
 *
 * `random` is a parameter so the distribution can be asserted rather than
 * sampled.
 */
export function nextRetryDelayMs(
	attempt: number,
	random: () => number = Math.random,
): number {
	const exponential = BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1);
	return Math.floor(random() * Math.min(BACKOFF_CAP_MS, exponential));
}

/**
 * Google's own `Retry-After`, when it sent one, in preference to a guess.
 *
 * Honouring the server's hint is strictly better than an exponential curve
 * invented here; the curve is the fallback for when there is no hint.
 */
export function retryDelayFor(
	failure: ClassifiedFailure,
	attempt: number,
	error: unknown,
	random: () => number = Math.random,
): number {
	const api = asApiError(error);
	if (api?.retryAfterMs !== undefined && api.retryAfterMs > 0) {
		return Math.min(api.retryAfterMs, BACKOFF_CAP_MS);
	}
	void failure;
	return nextRetryDelayMs(attempt, random);
}

export interface FailureRest {
	/** Non-null puts the pair out of the rotation. */
	disabledAt: Date | null;
	/** When the pair may be probed again. */
	retryAfter: Date | null;
}

/**
 * How long a pair rests after a failure has exhausted its retries.
 *
 * A permanent failure rests for a week and is then probed again — which is what
 * lets a consent category granted later start syncing with nobody touching
 * anything. Everything else rests an hour: long enough not to hammer a
 * Google-side incident, short enough that a deploy fixing the cause takes
 * effect the same day.
 */
export function restAfterFailure(
	failure: ClassifiedFailure,
	now: Date,
): FailureRest {
	if (failure.kind === "permanent") {
		return {
			disabledAt: now,
			retryAfter: new Date(now.getTime() + BLOCK_RETRY_DAYS * DAY_MS),
		};
	}
	return {
		disabledAt: now,
		retryAfter: new Date(now.getTime() + ERROR_COOLDOWN_MS),
	};
}
