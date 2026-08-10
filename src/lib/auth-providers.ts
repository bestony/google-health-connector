import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getGoogleOAuthConfig } from "./env.server";
import { createLogger } from "./logger.server";

/**
 * Which social providers the server has credentials for.
 *
 * The browser cannot read `process.env`, and a "Continue with Google" button
 * that only fails once the user clicks it is worse than no button at all. This
 * exposes the single boolean the UI needs — never the credentials themselves.
 *
 * Same isomorphic shape as `session.ts`: TanStack Start strips the `.handler()`
 * body (and the `env.server` import with it) from the client bundle, so route
 * files can import this freely.
 */

const log = createLogger("auth:providers");

export interface EnabledSocialProviders {
	google: boolean;
}

export const SOCIAL_PROVIDERS_QUERY_KEY = ["auth", "social-providers"] as const;

export const fetchSocialProviders = createServerFn({ method: "GET" }).handler(
	async (): Promise<EnabledSocialProviders> => {
		const providers = {
			google: getGoogleOAuthConfig().status === "configured",
		};
		log.debug("resolved enabled social providers", providers);
		return providers;
	},
);

export function socialProvidersQueryOptions() {
	return queryOptions({
		queryKey: SOCIAL_PROVIDERS_QUERY_KEY,
		queryFn: () => fetchSocialProviders(),
		// Provider configuration comes from the process environment and cannot
		// change without a restart, so this never needs refetching.
		staleTime: Number.POSITIVE_INFINITY,
	});
}
