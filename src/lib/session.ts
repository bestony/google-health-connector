import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth, type Session } from "./auth.server";
import { createLogger } from "./logger.server";

/**
 * Server-side session access for the router.
 *
 * This module is isomorphic on purpose: TanStack Start strips the `.handler()`
 * body — and with it the `auth.server` import — from the client bundle, while
 * the exported server function stays importable from route files and
 * components.
 *
 * Read the session through `sessionQueryOptions()` so it is fetched once per
 * request, cached by TanStack Query and dehydrated into the SSR payload,
 * instead of being re-fetched on every navigation.
 */

const log = createLogger("auth:session");

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

export const fetchSession = createServerFn({ method: "GET" }).handler(
	async (): Promise<Session | null> => {
		const session = await getAuth().api.getSession({
			headers: getRequest().headers,
		});

		log.debug("resolved session", { userId: session?.user.id ?? null });
		return session;
	},
);

export function sessionQueryOptions() {
	return queryOptions({
		queryKey: SESSION_QUERY_KEY,
		queryFn: () => fetchSession(),
		// The session cookie is authoritative; a short window is enough to avoid
		// refetching on every navigation without going stale after sign-in/out.
		staleTime: 60_000,
	});
}
