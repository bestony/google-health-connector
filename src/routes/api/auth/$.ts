import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../../../lib/auth.server";
import { createLogger } from "../../../lib/logger.server";

/**
 * Catch-all mount point for better-auth: `/api/auth/*`.
 *
 * better-auth ships a plain `Request -> Response` handler, so every auth
 * endpoint (sign-up, sign-in, sign-out, session, callbacks, ...) is served from
 * this single splat route. It must stay in sync with the client's base path,
 * which defaults to `/api/auth`.
 */

const log = createLogger("auth:route");

async function handle({ request }: { request: Request }): Promise<Response> {
	const url = new URL(request.url);
	const startedAt = performance.now();

	log.debug("request", { method: request.method, path: url.pathname });

	try {
		const response = await getAuth().handler(request);
		log.debug("response", {
			method: request.method,
			path: url.pathname,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt),
		});
		return response;
	} catch (error) {
		// Never leak internals to the caller; the detail goes to the server log.
		log.error("handler failed", {
			method: request.method,
			path: url.pathname,
			error: error instanceof Error ? error.stack : String(error),
		});
		return new Response("Internal Server Error", { status: 500 });
	}
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
		},
	},
});
