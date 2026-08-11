import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getAuthBaseUrl } from "../env.server";
import { createLogger } from "../logger.server";
import { MCP_ENDPOINT_PATH } from "./oauth-scopes";

/**
 * The absolute URL of this deployment's MCP endpoint.
 *
 * The dashboard prints a ready-to-paste `claude mcp add …` line, and a snippet
 * with the wrong host in it is worse than no snippet: it is copied once and
 * debugged later. The browser cannot read `BETTER_AUTH_URL`, so the server says
 * what its own origin is — the same variable the OAuth redirect URI is built
 * from, which means a deployment that gets this wrong is already broken in a
 * louder way.
 *
 * Same isomorphic shape as `auth-providers.ts`: TanStack Start strips the
 * `.handler()` body (and the `env.server` import with it) from the client
 * bundle, so route files and components can import this freely.
 */

const log = createLogger("mcp:endpoint");

export const MCP_ENDPOINT_QUERY_KEY = ["mcp", "endpoint"] as const;

export const fetchMcpEndpoint = createServerFn({ method: "GET" }).handler(
	async (): Promise<string> => {
		// `BETTER_AUTH_URL` is read verbatim from the environment, so it may well
		// arrive with a trailing slash; better-auth tolerates that but a naive
		// concatenation would print `https://host//mcp` into the snippet.
		const url = `${getAuthBaseUrl().replace(/\/+$/, "")}${MCP_ENDPOINT_PATH}`;
		log.debug("resolved mcp endpoint", { url });
		return url;
	},
);

export function mcpEndpointQueryOptions() {
	return queryOptions({
		queryKey: MCP_ENDPOINT_QUERY_KEY,
		queryFn: () => fetchMcpEndpoint(),
		// Derived from the process environment, which cannot change without a
		// restart, so this never needs refetching.
		staleTime: Number.POSITIVE_INFINITY,
	});
}
