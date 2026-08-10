import { createFileRoute } from "@tanstack/react-router";
import {
	handleMcpRequest,
	jsonRpcErrorResponse,
} from "../lib/mcp/handler.server";

/**
 * MCP endpoint: `POST /mcp`, speaking the Streamable HTTP transport.
 *
 * Point a client at `<origin>/mcp` — for example
 * `claude mcp add --transport http hello <origin>/mcp`.
 *
 * Only POST is served. GET (the standalone SSE stream for server-initiated
 * messages) and DELETE (session teardown) are both session-oriented, and this
 * server is stateless by design; the spec lets a server that offers no such
 * stream answer 405, which every conforming client handles.
 */

/** JSON-RPC "server error" code, the reserved range for implementation-defined faults. */
const METHOD_NOT_ALLOWED_CODE = -32000;

function methodNotAllowed(): Response {
	return jsonRpcErrorResponse(
		405,
		METHOD_NOT_ALLOWED_CODE,
		"Method not allowed. This MCP endpoint is stateless and only accepts POST.",
		{ Allow: "POST" },
	);
}

export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			POST: ({ request }) => handleMcpRequest(request),
			GET: () => methodNotAllowed(),
			DELETE: () => methodNotAllowed(),
		},
	},
});
