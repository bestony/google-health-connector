import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { countHealthDataPoints } from "../db/health-cache.server";
import {
	clearHealthSyncFailures,
	purgeUserHealthCache,
	readHealthSyncAccount,
	readHealthSyncStates,
	upsertHealthSyncAccount,
} from "../db/health-sync-state.server";
import { getAuth } from "./auth.server";
import { isHealthSyncEnabled } from "./env.server";
import { createLogger } from "./logger";

/**
 * The user's own switch for the health data cache, and what it is holding.
 *
 * This is the module that makes the privacy policy true. The policy says
 * nothing of a user's health data is stored until they turn this on, and that
 * turning it off deletes what was kept — so `enabled` defaults to false,
 * nothing but this module sets it, and disabling purges rather than marking a
 * row inactive.
 *
 * Same isomorphic shape as `api-key.ts`: TanStack Start strips the `.handler()`
 * body and its server imports from the client bundle, so the dashboard card can
 * import this directly.
 */

const log = createLogger("health-sync-preference");

export interface HealthSyncCoverageSummary {
	dataType: string;
	/** ISO 8601, or null when nothing has been fetched for this type yet. */
	coveredFrom: string | null;
	coveredThrough: string | null;
	lastSyncAt: string | null;
	pointCount: number;
}

export type HealthSyncPreference =
	/** The deployment does not run the sync at all. The card explains rather than offers. */
	| { status: "unavailable" }
	| {
			status: "ready";
			enabled: boolean;
			enabledAt: string | null;
			timeZone: string | null;
			timeZoneSource: string | null;
			/** Total cached points across every data type. */
			pointCount: number;
			/** Oldest and newest instants any data type has been synced through. */
			coveredFrom: string | null;
			coveredThrough: string | null;
			lastSyncAt: string | null;
			/** Data types Google refused, waiting on a re-probe. */
			blockedDataTypes: string[];
			types: HealthSyncCoverageSummary[];
	  };

export const HEALTH_SYNC_PREFERENCE_QUERY_KEY = ["health-sync"] as const;

/**
 * Resolve the caller's session or refuse.
 *
 * A server function is an HTTP endpoint like any other: the dashboard's route
 * guard does not protect it, so every call below re-checks for itself.
 */
async function requireUserId(headers: Headers): Promise<string> {
	const session = await getAuth().api.getSession({ headers });
	if (!session) {
		log.warn("rejected an unauthenticated health sync request");
		throw new Error("Sign in to manage your health data cache.");
	}
	return session.user.id;
}

const iso = (value: Date | null | undefined): string | null =>
	value === null || value === undefined ? null : value.toISOString();

const isoMs = (value: number | null | undefined): string | null =>
	value === null || value === undefined ? null : new Date(value).toISOString();

function minOf(values: readonly (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : Math.min(...present);
}

function maxOf(values: readonly (number | null)[]): number | null {
	const present = values.filter((value): value is number => value !== null);
	return present.length === 0 ? null : Math.max(...present);
}

export const fetchHealthSyncPreference = createServerFn({
	method: "GET",
}).handler(async (): Promise<HealthSyncPreference> => {
	const headers = getRequest().headers;
	const userId = await requireUserId(headers);

	if (!isHealthSyncEnabled()) return { status: "unavailable" };

	const [account, states, pointCount] = await Promise.all([
		readHealthSyncAccount(userId),
		readHealthSyncStates(userId),
		countHealthDataPoints(userId),
	]);

	const now = Date.now();
	return {
		blockedDataTypes: states
			.filter(
				(state) =>
					state.disabledAt !== null &&
					(state.retryAfter === null || state.retryAfter.getTime() > now),
			)
			.map((state) => state.dataType),
		coveredFrom: isoMs(minOf(states.map((state) => state.coveredFromMs))),
		coveredThrough: isoMs(maxOf(states.map((state) => state.coveredThroughMs))),
		enabled: account?.enabled ?? false,
		enabledAt: iso(account?.enabledAt),
		lastSyncAt: iso(
			states.reduce<Date | null>(
				(latest, state) =>
					state.lastSyncAt !== null &&
					(latest === null || state.lastSyncAt > latest)
						? state.lastSyncAt
						: latest,
				null,
			),
		),
		pointCount,
		status: "ready",
		timeZone: account?.timeZone ?? null,
		timeZoneSource: account?.timeZoneSource ?? null,
		types: states
			.filter((state) => state.lastSyncAt !== null)
			.map((state) => ({
				coveredFrom: isoMs(state.coveredFromMs),
				coveredThrough: isoMs(state.coveredThroughMs),
				dataType: state.dataType,
				lastSyncAt: iso(state.lastSyncAt),
				pointCount: state.lastPointCount,
			}))
			.sort((left, right) => (left.dataType < right.dataType ? -1 : 1)),
	};
});

/**
 * Turns the cache on or off for the signed-in user.
 *
 * Turning it **off deletes everything already cached**, immediately, rather
 * than marking the row inactive and leaving the data in place. That is not a
 * nicety: the privacy policy tells users that switching off removes the copy,
 * and a soft disable would make that sentence false.
 */
export const setHealthSyncEnabled = createServerFn({ method: "POST" })
	.inputValidator((enabled: boolean) => enabled)
	.handler(async ({ data: enabled }): Promise<HealthSyncPreference> => {
		const headers = getRequest().headers;
		const userId = await requireUserId(headers);
		const now = new Date();
		const existing = await readHealthSyncAccount(userId);

		await upsertHealthSyncAccount({
			disabledAt: enabled ? null : now,
			enabled,
			enabledAt: enabled
				? (existing?.enabledAt ?? now)
				: (existing?.enabledAt ?? null),
			// Forget what was learned about the user while they were opted out, so
			// re-enabling re-probes rather than trusting a year-old timezone.
			lastProbedAt: enabled ? (existing?.lastProbedAt ?? null) : null,
			membershipStartDateMs: enabled
				? (existing?.membershipStartDateMs ?? null)
				: null,
			timeZone: enabled ? (existing?.timeZone ?? null) : null,
			timeZoneSource: enabled ? (existing?.timeZoneSource ?? null) : null,
			userId,
		});

		if (!enabled) {
			await purgeUserHealthCache(userId);
		}

		log.info("health sync preference changed", { enabled, userId });
		return fetchHealthSyncPreference();
	});

/** Deletes everything cached without changing the switch. */
export const purgeHealthSyncCache = createServerFn({ method: "POST" }).handler(
	async (): Promise<HealthSyncPreference> => {
		const userId = await requireUserId(getRequest().headers);
		await purgeUserHealthCache(userId);
		log.info("health cache purged on request", { userId });
		return fetchHealthSyncPreference();
	},
);

/**
 * Puts data types Google refused back in the rotation.
 *
 * The sync re-probes a refused type weekly on its own. This exists for the case
 * where a user has just granted the missing category and would otherwise be
 * left wondering why nothing happened.
 */
export const retryBlockedHealthDataTypes = createServerFn({
	method: "POST",
}).handler(async (): Promise<HealthSyncPreference> => {
	const userId = await requireUserId(getRequest().headers);
	await clearHealthSyncFailures(userId);
	log.info("cleared blocked health data types", { userId });
	return fetchHealthSyncPreference();
});

export function healthSyncPreferenceQueryOptions() {
	return queryOptions({
		queryFn: () => fetchHealthSyncPreference(),
		queryKey: HEALTH_SYNC_PREFERENCE_QUERY_KEY,
		// Only this app's own mutations and the nightly sync change the answer,
		// and the mutations invalidate this themselves.
		staleTime: 60_000,
	});
}
