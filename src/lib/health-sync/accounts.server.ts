import {
	type HealthSyncAccountRow,
	listEnabledHealthSyncAccounts,
	readHealthSyncStates,
} from "../../db/health-sync-state.server";
import { getAuth } from "../auth.server";
import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import type { SyncCoverage } from "../google-health-sync-window";
import { USERS_PER_RUN } from "./config";
import {
	type EligibleUser,
	type LinkedAccountScopes,
	plannedDataTypes,
	selectEligibleUsers,
} from "./eligibility";
import type { PlannedUser } from "./plan";
import { DEFAULT_TIME_ZONE } from "./time-window";

/**
 * Assembling what the planner needs, from the database, for a cron request.
 *
 * The one thing to get right here is that **no request headers are involved**.
 * `google-health-access.ts` reads grants through
 * `auth.api.listUserAccounts({ headers })`, which resolves the *caller's*
 * session — and the caller here is a scheduler holding an operator secret, not
 * a user. Using that path would resolve to nobody and the sync would silently
 * find zero eligible users. The adapter is queried directly instead, the same
 * way `mcp/auth.server.ts` does for a request that authenticated with an API
 * key.
 */

/** Only a linked Google account can be read from. */
const GOOGLE_PROVIDER_ID = "google";

interface StoredAccountScopes {
	userId: string;
	scope: string | null;
}

/**
 * Every linked Google account, with the scopes Google returned for it.
 *
 * Read for all users rather than per user: the alternative is one query per
 * opted-in user before any work starts, and the rows are two short columns.
 */
export async function listLinkedGoogleAccounts(): Promise<
	LinkedAccountScopes[]
> {
	const context = await getAuth().$context;
	const rows = await context.adapter.findMany<StoredAccountScopes>({
		model: "account",
		select: ["userId", "scope"],
		where: [{ field: "providerId", value: GOOGLE_PROVIDER_ID }],
	});
	return rows.map((row) => ({ scope: row.scope, userId: row.userId }));
}

function coverageOf(row: {
	coveredFromMs: number | null;
	coveredThroughMs: number | null;
}): SyncCoverage {
	return { fromMs: row.coveredFromMs, throughMs: row.coveredThroughMs };
}

/**
 * Which data types are out of the rotation for a user right now.
 *
 * A disabled pair whose re-probe has come due is *not* blocked: that is the
 * mechanism by which a consent category granted last week starts syncing
 * without anybody doing anything.
 */
function blockedTypes(
	states: readonly {
		dataType: string;
		disabledAt: Date | null;
		retryAfter: Date | null;
	}[],
	now: Date,
): Set<string> {
	const blocked = new Set<string>();
	for (const state of states) {
		if (state.disabledAt === null) continue;
		const due =
			state.retryAfter !== null && state.retryAfter.getTime() <= now.getTime();
		if (!due) blocked.add(state.dataType);
	}
	return blocked;
}

export interface LoadedUsers {
	users: PlannedUser[];
	/** Everyone who opted in, before the Google grant was checked. */
	optedIn: number;
}

/**
 * The users this invocation may work on, with their coverage loaded.
 *
 * Two gates, both of which must be open, and they are deliberately separate:
 * `health_sync_account.enabled` is the user's own decision, and a readable
 * Google scope is Google's. Someone who opted in and then revoked at Google
 * disappears from here without their opt-in being touched, so re-granting
 * brings them straight back.
 */
export async function loadPlannedUsers(
	now: Date,
	allowlist: readonly GoogleHealthDataTypeId[] = [],
	limit: number = USERS_PER_RUN,
): Promise<LoadedUsers> {
	const accounts = await listEnabledHealthSyncAccounts(limit);
	if (accounts.length === 0) return { optedIn: 0, users: [] };

	const enabled = new Map(accounts.map((row) => [row.userId, row]));
	const eligible = selectEligibleUsers(await listLinkedGoogleAccounts()).filter(
		(user) => enabled.has(user.userId),
	);

	const dataTypes = plannedDataTypes(allowlist);
	const users = await Promise.all(
		eligible.map(async (user) =>
			toPlannedUser(
				user,
				enabled.get(user.userId) as HealthSyncAccountRow,
				dataTypes,
				now,
			),
		),
	);

	return { optedIn: accounts.length, users };
}

async function toPlannedUser(
	user: EligibleUser,
	account: HealthSyncAccountRow,
	dataTypes: readonly GoogleHealthDataTypeId[],
	now: Date,
): Promise<PlannedUser> {
	const states = await readHealthSyncStates(user.userId);
	return {
		blocked: blockedTypes(states, now),
		coverage: new Map(
			states.map((state) => [state.dataType, coverageOf(state)]),
		),
		dataTypes,
		membershipStartMs: account.membershipStartDateMs ?? undefined,
		timeZone: account.timeZone ?? DEFAULT_TIME_ZONE,
		userId: user.userId,
	};
}
