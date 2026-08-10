import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isLevelEnabled } from "../env.server";
import { createLogger } from "../logger.server";
import { createMcpServer } from "./server";

/**
 * HTTP bridge for the MCP server: `Request` in, `Response` out.
 *
 * Uses the SDK's Web-Standard Streamable HTTP transport rather than the
 * Node/Express one, because a TanStack Start server route hands us a `Request`
 * and expects a `Response` — no `http.IncomingMessage` in sight.
 *
 * The transport runs stateless: a fresh server *and* transport per request. The
 * SDK enforces this (a stateless transport throws if reused), and it is also
 * what makes the route safe on a serverless host, where consecutive requests
 * routinely land on different instances.
 */

const log = createLogger("mcp:handler");

/** JSON-RPC internal error, per the spec's reserved code range. */
const INTERNAL_ERROR = -32603;

/**
 * Build a JSON-RPC error response.
 *
 * `id: null` is the correct reply when the failure happened before — or
 * independently of — parsing a request id, which is true of every error this
 * module raises itself.
 */
export function jsonRpcErrorResponse(
	status: number,
	code: number,
	message: string,
	headers?: Record<string, string>,
): Response {
	return new Response(
		JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
		{
			status,
			headers: { "Content-Type": "application/json", ...headers },
		},
	);
}

/**
 * Best-effort read of the JSON-RPC method names in the body, for logging only.
 *
 * Knowing whether a request was `initialize`, `tools/list` or `tools/call` is
 * the single most useful line when debugging an MCP client, and the client's
 * own logs are usually out of reach. It reads a clone so the transport still
 * gets an unconsumed body, and it never throws: a malformed body is the
 * transport's job to reject with a proper parse error, not ours.
 */
async function peekRpcMethods(request: Request): Promise<string[] | undefined> {
	try {
		const body: unknown = await request.clone().json();
		const messages = Array.isArray(body) ? body : [body];
		return messages.map((message) => {
			const method = (message as { method?: unknown } | null)?.method;
			return typeof method === "string" ? method : "<non-request>";
		});
	} catch {
		return undefined;
	}
}

export async function handleMcpRequest(request: Request): Promise<Response> {
	const startedAt = performance.now();
	// Cloning and parsing the body costs a full extra read, so it only happens
	// when the log level would actually emit the result.
	const methods = isLevelEnabled("debug")
		? await peekRpcMethods(request)
		: undefined;

	log.debug("request", { method: request.method, rpc: methods ?? null });

	const server = createMcpServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		// Stateless mode. The trade-off is that server-initiated traffic
		// (sampling, elicitation, subscriptions) is unavailable — none of which
		// this server uses.
		sessionIdGenerator: undefined,
		// Answer with one buffered JSON body instead of opening an SSE stream.
		// Nothing here reports progress, and an idle long-lived stream is exactly
		// what a serverless platform bills for and then kills mid-flight.
		enableJsonResponse: true,
	});

	// Protocol-level problems (bad Accept header, unparseable JSON-RPC) are
	// reported here *and* returned to the client as an error response, so this
	// stays at warn: it is a client mistake, not a server fault.
	transport.onerror = (error) => {
		log.warn("transport error", { rpc: methods ?? null, error: error.message });
	};

	try {
		await server.connect(transport);
		const response = await transport.handleRequest(request);
		log.debug("response", {
			rpc: methods ?? null,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt),
		});
		return response;
	} catch (error) {
		// Never leak internals to the caller; the detail goes to the server log.
		log.error("handler failed", {
			rpc: methods ?? null,
			error: error instanceof Error ? error.stack : String(error),
		});
		return jsonRpcErrorResponse(500, INTERNAL_ERROR, "Internal server error");
	} finally {
		// Safe to tear down here: in JSON-response mode the body is fully
		// serialised by the time `handleRequest` resolves, so closing cannot
		// truncate it. `server.close()` closes the transport it is connected to;
		// closing the transport too covers a failure inside `connect()` itself.
		// Both are idempotent, and a teardown fault must never replace the real
		// outcome of the request.
		try {
			await server.close();
			await transport.close();
		} catch (error) {
			log.warn("teardown failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
