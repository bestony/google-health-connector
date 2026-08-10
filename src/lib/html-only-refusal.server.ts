import { createLogger } from "./logger.server";

/**
 * Turn TanStack Start's "this handler only speaks HTML" refusal into a 404.
 *
 * The SSR handler answers the page routes, and it can only render HTML. Asked
 * for anything else — `Accept: application/json`, `text/plain`,
 * `application/xml` — it gives up with a **500**, and it does so for every page
 * route and for unmatched paths alike. A 500 says "this server is broken";
 * nothing is broken, the caller simply asked for a representation that does not
 * exist here. Server routes (`/mcp`, `/api/auth/*`) never reach that branch.
 *
 * The distinction is not cosmetic for this app. An MCP client that gets a 401
 * from `POST /mcp` follows RFC 9728 and probes
 * `/.well-known/oauth-protected-resource` with `Accept: application/json`. This
 * server authenticates with API keys and deliberately publishes no OAuth
 * metadata, so the honest answer is 404 — "no OAuth here, send the key". A 500
 * instead reads as a server fault worth retrying, which is the one conclusion
 * that leaves the client stuck.
 *
 * 404 rather than 406 for the page routes too: the only machine-readable
 * surfaces this deployment has are `/mcp` and `/api/auth/*`, both server
 * routes, so for a non-HTML caller there really is nothing at any other path.
 */

const log = createLogger("http:accept");

/**
 * The refusal, byte for byte.
 *
 * Emitted by `createStartHandler` in `@tanstack/start-server-core` as
 * `Response.json({ error: "Only HTML requests are supported here" }, { status: 500 })`.
 *
 * Matching the body — rather than "a 500 that happens to be JSON" — is what
 * keeps `/mcp` intact: a tool that genuinely fails also answers 500 with a JSON
 * body, and that must reach the caller untouched. Should a future TanStack
 * version reword this, the match simply stops firing and behaviour falls back
 * to today's; a stale constant costs the fix, never correctness.
 */
const HTML_ONLY_REFUSAL_BODY =
	'{"error":"Only HTML requests are supported here"}';

/** What the SSR handler is willing to produce. Mirrors the framework's own test. */
const HTML_MEDIA_TYPES = ["*/*", "text/html"] as const;

/**
 * Would the SSR handler agree to answer this request?
 *
 * Deliberately the same prefix match the framework performs, so the two cannot
 * disagree about which requests are at risk: an absent `Accept` counts as the
 * wildcard, and a parameterised type such as `text/html;q=0.9` still counts as
 * HTML.
 */
export function acceptsHtml(request: Request): boolean {
	const offered = (request.headers.get("Accept") || "*/*").split(",");
	return HTML_MEDIA_TYPES.some((mediaType) =>
		offered.some((part) => part.trim().startsWith(mediaType)),
	);
}

/**
 * Swap the framework's refusal for a 404; pass every other response through.
 */
export async function replaceHtmlOnlyRefusal(
	request: Request,
	response: Response,
): Promise<Response> {
	// Two free checks first. The refusal is always a 500 and only ever reaches a
	// caller that asked for something other than HTML, so every browser
	// navigation and every successful API call leaves here without its body
	// being touched.
	if (response.status !== 500 || acceptsHtml(request)) return response;

	let body: string;
	try {
		// A clone, so the real body survives unread if this turns out to be
		// somebody else's 500. `clone()` throws once a body has been consumed —
		// nothing upstream of the server entry does that, but a teardown race must
		// not turn into a second failure on top of the first.
		body = await response.clone().text();
	} catch (error) {
		log.warn("could not inspect 500 body", {
			error: error instanceof Error ? error.message : String(error),
		});
		return response;
	}

	if (body !== HTML_ONLY_REFUSAL_BODY) return response;

	log.info("answered non-html request with 404", {
		path: new URL(request.url).pathname,
		accept: request.headers.get("Accept"),
	});

	return Response.json(
		{ error: "Not found. This path is served as HTML only." },
		{ status: 404 },
	);
}
