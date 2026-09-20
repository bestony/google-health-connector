import {
	GOOGLE_HEALTH_DATA_POINT_TYPES,
	GOOGLE_HEALTH_READ_SCOPES,
	type GoogleHealthDataTypeId,
} from "../google-health-api.gen";

/**
 * Who the sync may act for, and over which data types.
 *
 * Two independent gates, and both have to be open. The user must have opted in
 * — `health_sync_account.enabled`, which the dashboard sets and nothing else
 * does — and Google must have granted at least one readable health scope. A
 * user who opted in and then revoked at Google is not eligible, and neither is
 * one who granted every scope and never opted in.
 *
 * Pure string work over the `account.scope` column better-auth maintains, which
 * holds what Google *returned* rather than what was asked for.
 */

const READ_SCOPES = new Set(GOOGLE_HEALTH_READ_SCOPES);

/** better-auth writes the scope column space-separated; some providers use commas. */
const SCOPE_SEPARATOR = /[\s,]+/;

/** A row as `account` stores it: the scope column is a space-separated list. */
export interface LinkedAccountScopes {
	userId: string;
	scope?: string | null;
}

/** Splits better-auth's scope column, tolerating commas and extra whitespace. */
export function parseGrantedScopes(scope: string | null | undefined): string[] {
	if (scope === null || scope === undefined) return [];
	return scope
		.split(SCOPE_SEPARATOR)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

/** The readable health scopes this user actually granted. */
export function readableGrantedScopes(
	scope: string | null | undefined,
): string[] {
	return parseGrantedScopes(scope).filter((entry) => READ_SCOPES.has(entry));
}

export interface EligibleUser {
	userId: string;
	/** The readable scopes Google granted — never the ones that were requested. */
	grantedReadScopes: string[];
}

/**
 * The users the sync may read for, deduplicated and in a stable order.
 *
 * A user with more than one linked Google account keeps the union of their
 * grants: better-auth resolves tokens from the first such account, but which
 * one is first is not something this module should encode, and the union is the
 * safe reading either way — Google's own 403 is the final word on any scope.
 *
 * Ordered by user id so the planner's rotation cursor is stable across
 * invocations, which is what keeps one user from being visited twice before
 * another is visited once.
 */
export function selectEligibleUsers(
	accounts: readonly LinkedAccountScopes[],
): EligibleUser[] {
	const byUser = new Map<string, Set<string>>();

	for (const account of accounts) {
		const granted = readableGrantedScopes(account.scope);
		if (granted.length === 0) continue;
		const existing = byUser.get(account.userId);
		if (existing === undefined) {
			byUser.set(account.userId, new Set(granted));
			continue;
		}
		for (const scope of granted) existing.add(scope);
	}

	return [...byUser.entries()]
		.map(([userId, scopes]) => ({
			grantedReadScopes: [...scopes].sort(),
			userId,
		}))
		.sort((left, right) => (left.userId < right.userId ? -1 : 1));
}

/**
 * The data types the sync will try, in catalog order.
 *
 * Deliberately not narrowed by the user's granted scopes. Google publishes no
 * mapping from the forty data types onto its twelve consent categories, and
 * `mcp/health.ts` already refuses to invent one; inventing it here would be the
 * same guess with the same way of going stale silently.
 *
 * So the sync probes, and remembers: a type that answers 403 or 404 is recorded
 * against that user in `health_sync_state` and skipped until its re-probe comes
 * due. The first night for a user is noisy and the ones after it are cheap —
 * this is the mechanism that learns each user's readable subset, and it is
 * accurate in a way a hardcoded table could not be.
 *
 * `allowlist` narrows it for an operator who wants a smaller sync, and is empty
 * by default.
 */
export function plannedDataTypes(
	allowlist: readonly GoogleHealthDataTypeId[] = [],
): GoogleHealthDataTypeId[] {
	if (allowlist.length > 0) {
		const wanted = new Set<string>(allowlist);
		return GOOGLE_HEALTH_DATA_POINT_TYPES.filter((type) =>
			wanted.has(type.id),
		).map((type) => type.id);
	}
	return GOOGLE_HEALTH_DATA_POINT_TYPES.map((type) => type.id);
}

/** Whether a string names a data type in the generated catalog. */
export function isKnownDataType(id: string): id is GoogleHealthDataTypeId {
	return GOOGLE_HEALTH_DATA_POINT_TYPES.some((type) => type.id === id);
}
