import type { Register } from "@tanstack/react-router";
import {
	createStartHandler,
	defaultStreamHandler,
	type RequestHandler,
} from "@tanstack/react-start/server";
import { replaceHtmlOnlyRefusal } from "./lib/html-only-refusal.server";

/**
 * The server entry: TanStack Start's request handler, with one correction.
 *
 * Providing this file replaces the framework's default entry, which is exactly
 * `createStartHandler(defaultStreamHandler)` and nothing more. It is the right
 * seam for a fix that has to see *every* response — page routes and server
 * routes alike — and, unlike a `src/start.ts`, it does not displace the request
 * middleware the framework installs on its own, so server functions keep the
 * CSRF protection they get by default.
 */

const handleRequest = createStartHandler(defaultStreamHandler);

export default {
	async fetch(request, options) {
		const response = await handleRequest(request, options);
		return replaceHtmlOnlyRefusal(request, response);
	},
} satisfies { fetch: RequestHandler<Register> };
