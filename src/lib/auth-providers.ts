import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getGoogleOAuthConfig } from "./env.server";
import { createLogger } from "./logger.server";

/**
 * Which social providers the server has credentials for.
 *
 * The browser cannot read `process.env`, and a "Continue with Google" button
 * that only fails once the user clicks it is worse than no button at all. This
 * exposes what the UI needs and nothing more — never the client secret.
 *
 * Same isomorphic shape as `session.ts`: TanStack Start strips the `.handler()`
 * body (and the `env.server` import with it) from the client bundle, so route
 * files can import this freely.
 */

const log = createLogger("auth:providers");

export interface EnabledSocialProviders {
	/** Whether Google sign-in can be offered at all. */
	google: boolean;

	/**
	 * Google's OAuth **client ID**, or `null` when Google sign-in is off.
	 *
	 * Unlike the client secret this value is public by design — it travels in
	 * every authorization URL Google receives — and Google One Tap cannot
	 * initialize without it in the browser. Serving it from here instead of a
	 * `VITE_`-prefixed build constant keeps `.env` the single source of truth
	 * and lets one build run against several environments.
	 */
	googleClientId: string | null;
}

export const SOCIAL_PROVIDERS_QUERY_KEY = ["auth", "social-providers"] as const;

export const fetchSocialProviders = createServerFn({ method: "GET" }).handler(
	async (): Promise<EnabledSocialProviders> => {
		const google = getGoogleOAuthConfig();
		const providers: EnabledSocialProviders = {
			google: google.status === "configured",
			googleClientId: google.status === "configured" ? google.clientId : null,
		};
		log.debug("resolved enabled social providers", { ...providers });
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
