import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "./auth.server";
import { getGoogleOAuthConfig } from "./env.server";
import { isGoogleHealthScope } from "./google-health-scopes";
import { createLogger } from "./logger.server";

/**
 * Which Google Health scopes the signed-in user has actually granted.
 *
 * The authoritative answer is the `scope` column better-auth writes on the
 * linked `account` row after every OAuth round trip — it holds what *Google*
 * returned, not what was requested, so a user who unticked "Sleep" on the
 * consent screen shows up here as not having granted it.
 *
 * Same isomorphic shape as `session.ts` and `auth-providers.ts`: TanStack Start
 * strips the `.handler()` body (and the `auth.server` import with it) from the
 * client bundle, so route files and components can import this freely.
 */

const log = createLogger("google-health:access");

/** better-auth's provider id for Google. Matches `socialProviders.google`. */
const GOOGLE_PROVIDER_ID = "google";

export type GoogleHealthAccess =
	/** The server has no Google OAuth credentials; nothing can be authorized. */
	| { status: "disabled" }
	/** Signed in, but no Google account is linked to this user yet. */
	| { status: "unlinked" }
	/** A Google account is linked. `grantedScopes` may still be empty. */
	| { status: "linked"; accountId: string; grantedScopes: string[] }
	/** The lookup itself failed. Rendered as a warning, not as "not connected". */
	| { status: "unavailable" };

export const GOOGLE_HEALTH_ACCESS_QUERY_KEY = [
	"google-health",
	"access",
] as const;

export const fetchGoogleHealthAccess = createServerFn({
	method: "GET",
}).handler(async (): Promise<GoogleHealthAccess> => {
	if (getGoogleOAuthConfig().status === "unconfigured") {
		log.debug("google oauth is not configured");
		return { status: "disabled" };
	}

	let accounts: Awaited<
		ReturnType<ReturnType<typeof getAuth>["api"]["listUserAccounts"]>
	>;
	try {
		accounts = await getAuth().api.listUserAccounts({
			headers: getRequest().headers,
		});
	} catch (error) {
		// A missing session cannot happen behind the dashboard guard, so this
		// is a database or adapter failure. Degrade to a warning rather than
		// taking the whole page down over one card.
		log.error("could not list linked accounts", {
			error: error instanceof Error ? error.message : String(error),
		});
		return { status: "unavailable" };
	}

	const googleAccounts = accounts.filter(
		(linkedAccount) => linkedAccount.providerId === GOOGLE_PROVIDER_ID,
	);

	if (googleAccounts.length === 0) {
		log.debug("no google account linked", { accounts: accounts.length });
		return { status: "unlinked" };
	}

	// better-auth resolves tokens by taking the first account matching the
	// provider, so the scopes shown have to come from that same row or the UI
	// would describe an account the API calls will not use.
	const [account] = googleAccounts;
	if (googleAccounts.length > 1) {
		log.warn("multiple google accounts linked; using the first", {
			count: googleAccounts.length,
			accountId: account.accountId,
		});
	}

	const grantedScopes = account.scopes.filter(isGoogleHealthScope);
	log.debug("resolved google health access", {
		accountId: account.accountId,
		grantedScopes: grantedScopes.length,
		totalScopes: account.scopes.length,
	});

	return { status: "linked", accountId: account.accountId, grantedScopes };
});

export function googleHealthAccessQueryOptions() {
	return queryOptions({
		queryKey: GOOGLE_HEALTH_ACCESS_QUERY_KEY,
		queryFn: () => fetchGoogleHealthAccess(),
		// Grants only change by way of a full-page round trip through Google, so
		// a short window is enough to avoid refetching on every navigation.
		staleTime: 60_000,
	});
}
