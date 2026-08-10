import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getAuthBaseUrl } from "../env.server";
import { LEGAL } from "../legal";
import { createLogger } from "../logger.server";
import type { McpIdentity } from "./auth.server";
import { buildGreeting } from "./hello";

/**
 * Assembly of the MCP server: what tools, resources and prompts this app
 * exposes to an MCP client.
 *
 * Everything lives behind a factory rather than a module-level singleton on
 * purpose. `McpServer` keeps a reference to the single transport it is
 * connected to, and the HTTP transport runs in stateless mode (one transport
 * per request), so a shared instance would have concurrent requests overwrite
 * each other's transport and cross-deliver responses. Building a server is
 * cheap — it is just a handful of handler registrations.
 *
 * The caller's identity is an argument for the same reason: it belongs to one
 * request, so the handlers close over that request's identity rather than
 * reaching for something ambient.
 *
 * Discovery is open and invocation is not. Anyone may `initialize` and list the
 * tools — that is how a user decides whether a key is worth getting — but
 * calling one, or reading a resource, needs an API key.
 */

const log = createLogger("mcp:server");

/**
 * Advertised to clients during `initialize`.
 *
 * `version` is written out rather than imported from `package.json`, which is
 * not a module this bundle should pull in; it tracks the package version by
 * hand, so bump both together.
 *
 * `name` is the programmatic identifier and `title` the display name. A client
 * older than the `title` field falls back to rendering `name`, so the two are
 * kept as the same brand rather than left to drift. Reading the display name
 * from `LEGAL` means a product rename stays one edit, in the one place the
 * Google consent screen and the legal documents already read from.
 */
export const MCP_SERVER_INFO = {
	name: "ghealth-connector",
	title: LEGAL.appName,
	version: "0.0.1",
	websiteUrl: LEGAL.siteUrl,
} as const;

/** URI of the static greeting resource. Resources are addressed by URI, not by name. */
const GREETING_RESOURCE_URI = "hello://world";

/**
 * What an anonymous caller is told when it tries to invoke something.
 *
 * It names the credential, where to get one and which header carries it,
 * because whatever reads this message is relaying to a human who can act on
 * exactly those three facts. A request that reaches this point carried no key
 * at all — one that carried a bad key never got here, it was answered with 401.
 *
 * The dashboard link is built from the origin this deployment is configured
 * for, not from `LEGAL.siteUrl`: the client is already talking to *this* server,
 * so sending it to the canonical marketing domain would be sending it somewhere
 * it may have no account — and, on localhost or a preview deployment, somewhere
 * entirely unrelated.
 */
function unauthorizedMessage(): string {
	const dashboard = `${getAuthBaseUrl().replace(/\/+$/, "")}/dashboard`;
	return (
		`This ${LEGAL.appName} MCP server requires an API key to invoke ` +
		`anything. Generate one on the dashboard at ${dashboard}, then send it ` +
		"with every request as `Authorization: Bearer <key>`."
	);
}

export function createMcpServer(identity: McpIdentity): McpServer {
	const server = new McpServer(MCP_SERVER_INFO, {
		// Stated up front rather than discovered on the first refusal: a client
		// that knows the rule can ask its user for a key before spending a call.
		instructions:
			`Hello-world MCP server for ${LEGAL.appName}. Call \`say_hello\` to ` +
			"greet someone, or read `hello://world` for a static greeting. " +
			"Listing what is on offer is open to anyone; invoking it requires an " +
			"API key sent as `Authorization: Bearer <key>`.",
	});

	server.registerTool(
		"say_hello",
		{
			title: "Say hello",
			description:
				"Return a friendly greeting. Pass `name` to greet someone specific; " +
				"omit it to greet the world. Requires an API key.",
			inputSchema: {
				name: z
					.string()
					.optional()
					.describe("Who to greet. Defaults to 'World' when omitted."),
			},
			// Advertised so clients can call this without a confirmation prompt: it
			// touches no state and reaches nothing outside the process.
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			},
		},
		({ name }) => {
			if (!identity.authenticated) {
				log.info("refused tool say_hello: no api key");
				// Reported in-band, with `isError`, rather than thrown: the protocol
				// reserves JSON-RPC errors for a call that could not be *understood*
				// and keeps failures of the call itself in the result, where the
				// model can read them and tell its user what to do.
				return {
					content: [{ type: "text", text: unauthorizedMessage() }],
					isError: true,
				};
			}

			const greeting = buildGreeting(name);
			log.debug("tool say_hello", {
				userId: identity.userId,
				name: name ?? null,
				greeting,
			});
			return { content: [{ type: "text", text: greeting }] };
		},
	);

	server.registerResource(
		"greeting",
		GREETING_RESOURCE_URI,
		{
			title: "Greeting",
			description: "A static hello-world greeting. Requires an API key.",
			mimeType: "text/plain",
		},
		(uri) => {
			if (!identity.authenticated) {
				log.info("refused resource read: no api key", { uri: uri.href });
				// A resource read has no in-band error channel — it either returns
				// contents or it does not — so this refusal is a protocol error.
				throw new McpError(ErrorCode.InvalidRequest, unauthorizedMessage());
			}

			log.debug("resource read", { userId: identity.userId, uri: uri.href });
			return {
				contents: [
					{
						uri: uri.href,
						mimeType: "text/plain",
						text: buildGreeting(),
					},
				],
			};
		},
	);

	return server;
}
