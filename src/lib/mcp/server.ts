import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LEGAL } from "../legal";
import { createLogger } from "../logger.server";
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
 */

const log = createLogger("mcp:server");

/**
 * Advertised to clients during `initialize`; keep the version in step with releases.
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
	version: "1.0.0",
	websiteUrl: LEGAL.siteUrl,
} as const;

/** URI of the static greeting resource. Resources are addressed by URI, not by name. */
const GREETING_RESOURCE_URI = "hello://world";

export function createMcpServer(): McpServer {
	const server = new McpServer(MCP_SERVER_INFO, {
		instructions:
			`Hello-world MCP server for ${LEGAL.appName}. Call \`say_hello\` to ` +
			"greet someone, or read `hello://world` for a static greeting.",
	});

	server.registerTool(
		"say_hello",
		{
			title: "Say hello",
			description:
				"Return a friendly greeting. Pass `name` to greet someone specific; " +
				"omit it to greet the world.",
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
			const greeting = buildGreeting(name);
			log.debug("tool say_hello", { name: name ?? null, greeting });
			return { content: [{ type: "text", text: greeting }] };
		},
	);

	server.registerResource(
		"greeting",
		GREETING_RESOURCE_URI,
		{
			title: "Greeting",
			description: "A static hello-world greeting.",
			mimeType: "text/plain",
		},
		(uri) => {
			log.debug("resource read", { uri: uri.href });
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
