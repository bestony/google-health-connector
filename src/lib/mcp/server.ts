import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAuthBaseUrl } from "../env.server";
import type { GoogleHealthDataTypeId } from "../google-health-api.gen";
import {
	createGoogleHealthClient,
	GoogleHealthApiError,
} from "../google-health-api.server";
import { GoogleHealthAuthorizationError } from "../google-health-token.server";
import { LEGAL } from "../legal";
import { createLogger } from "../logger.server";
import type { McpIdentity } from "./auth.server";
import {
	clampHistoryWindow,
	describeDataTypes,
	HISTORY_LIMIT_DAYS,
	readableCategories,
	scopeCategory,
	summarizeDataPoint,
} from "./health";

/**
 * Assembly of the MCP server: what tools this app exposes to an MCP client.
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
 * calling one needs an API key. Nothing outside a tool handler touches Google
 * or the database, so an anonymous `tools/list` costs a listing and no more.
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

/** How many points a read returns when the caller does not say. */
const DEFAULT_LIMIT = 50;

/**
 * The most a single read will return.
 *
 * A day of heart-rate samples is thousands of points, and every one of them
 * lands in the model's context. The cap is a limit on how much of a caller's
 * budget one tool call can spend, not on how much data exists — the reply says
 * when it truncated, and a narrower window is the way to get the rest.
 */
const MAX_LIMIT = 500;

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
function dashboardUrl(): string {
	return `${getAuthBaseUrl().replace(/\/+$/, "")}/dashboard`;
}

function unauthorizedMessage(): string {
	return (
		`This ${LEGAL.appName} MCP server requires an API key to invoke ` +
		`anything. Generate one on the dashboard at ${dashboardUrl()}, then send ` +
		"it with every request as `Authorization: Bearer <key>`."
	);
}

/** A tool result carrying text. */
function text(body: string, isError = false) {
	return { content: [{ type: "text" as const, text: body }], isError };
}

/** A tool result carrying JSON, which is what these tools mostly return. */
function json(payload: unknown) {
	return text(JSON.stringify(payload, null, 2));
}

/**
 * Turns a failed Google call into something a model can act on.
 *
 * A 403 is the failure a user will actually hit — they connected Google Health
 * but left a category unticked — and "PERMISSION_DENIED" on its own tells them
 * nothing to do about it. The reply names the categories that can be read at
 * all, the ones this user granted, and where to change that.
 */
function describeApiError(
	error: unknown,
	grantedScopes: readonly string[],
): string {
	// The likeliest failure of all, and it happens before Google is even called:
	// the user has an account and an API key but never authorized Google Health,
	// or revoked it since. On its own the message says what is wrong and not
	// where to fix it.
	if (error instanceof GoogleHealthAuthorizationError) {
		return `${error.message} Do that at ${dashboardUrl()}.`;
	}

	if (!(error instanceof GoogleHealthApiError)) {
		return error instanceof Error ? error.message : String(error);
	}

	if (error.status === 401 || error.status === 403) {
		const granted = grantedScopes.map(scopeCategory);
		return (
			`Google refused this read (${error.googleStatus ?? error.status}). ` +
			"That normally means the category was not granted on the consent " +
			`screen. This API can read: ${readableCategories().join(", ")}. ` +
			`You granted: ${granted.length > 0 ? granted.join(", ") : "nothing yet"}. ` +
			`Reconnect Google Health at ${dashboardUrl()} to change that.`
		);
	}

	return (
		`Google Health returned ${error.status}` +
		`${error.googleStatus ? ` (${error.googleStatus})` : ""}: ${error.message}` +
		`${error.retryable ? " This one is worth retrying." : ""}`
	);
}

export function createMcpServer(identity: McpIdentity): McpServer {
	const server = new McpServer(MCP_SERVER_INFO, {
		// Stated up front rather than discovered on the first refusal: a client
		// that knows the rules can ask its user for a key, and can pick a data
		// type, before spending a call finding out.
		instructions:
			`Read the signed-in user's Google Health data for ${LEGAL.appName}. ` +
			"Call `list_health_data_types` first to see what can be queried, then " +
			"`read_health_data` for a data type and time range. Listing the tools " +
			"is open to anyone; calling one requires an API key sent as " +
			`\`Authorization: Bearer <key>\`. Reads reach back at most ${HISTORY_LIMIT_DAYS} days.`,
	});

	/** Refuses an anonymous caller, or hands over a client for the real one. */
	function clientFor(tool: string) {
		if (!identity.authenticated) {
			log.info("refused tool: no api key", { tool });
			return null;
		}
		return createGoogleHealthClient({ userId: identity.userId });
	}

	server.registerTool(
		"list_health_data_types",
		{
			title: "List health data types",
			description:
				"List every Google Health data type that can be queried, with how " +
				"each one is timed. Call this before `read_health_data` rather than " +
				"guessing an id. Requires an API key, but reaches nothing outside " +
				"this server.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		() => {
			if (!identity.authenticated) {
				return text(unauthorizedMessage(), true);
			}

			return json({
				dataTypes: describeDataTypes(),
				readableCategories: readableCategories(),
				note:
					"A data type can only be read if the user granted its consent " +
					"category. Categories outside `readableCategories` are write-only " +
					"in this API version and can never be read back.",
			});
		},
	);

	server.registerTool(
		"read_health_data",
		{
			title: "Read health data",
			description:
				"Read the user's data points for one data type over a time range. " +
				"Use an id from `list_health_data_types`. Times are RFC 3339, e.g. " +
				"`2026-08-01T00:00:00Z`; omit them to get the most recent data.",
			inputSchema: {
				dataType: z
					.string()
					.describe("Data type id, e.g. `steps`, `sleep`, `heart-rate`."),
				from: z
					.string()
					.optional()
					.describe(
						"Inclusive start, RFC 3339. Defaults to the oldest readable.",
					),
				to: z
					.string()
					.optional()
					.describe("Exclusive end, RFC 3339. Defaults to now."),
				limit: z
					.number()
					.int()
					.positive()
					.max(MAX_LIMIT)
					.optional()
					.describe(
						`How many points to return. Defaults to ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`,
					),
			},
			// Reaches Google, so not a closed world — but it only ever reads.
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async ({ dataType, from, to, limit }) => {
			const client = clientFor("read_health_data");
			if (!client) return text(unauthorizedMessage(), true);

			const parsedFrom = from === undefined ? undefined : new Date(from);
			const parsedTo = to === undefined ? undefined : new Date(to);
			for (const [label, value] of [
				["from", parsedFrom],
				["to", parsedTo],
			] as const) {
				if (value !== undefined && Number.isNaN(value.getTime())) {
					return text(
						`\`${label}\` is not a date this server can read. Use RFC 3339, e.g. 2026-08-01T00:00:00Z.`,
						true,
					);
				}
			}

			const window = clampHistoryWindow(
				{ from: parsedFrom, to: parsedTo },
				new Date(),
			);

			try {
				const points = await client.collectDataPoints(
					dataType as GoogleHealthDataTypeId,
					{
						from: window.from,
						to: window.to,
						limit: limit ?? DEFAULT_LIMIT,
					},
				);

				log.debug("read health data", {
					userId: identity.authenticated ? identity.userId : null,
					dataType,
					points: points.length,
					clamped: window.clamped,
				});

				return json({
					dataType,
					from: window.from.toISOString(),
					to: window.to?.toISOString() ?? null,
					count: points.length,
					truncated: points.length >= (limit ?? DEFAULT_LIMIT),
					historyClamped: window.clamped
						? `Your requested start was earlier than this account's ${window.limitDays}-day history window, so it was moved forward. Older data was not searched.`
						: undefined,
					dataPoints: points.map(summarizeDataPoint).filter(Boolean),
				});
			} catch (error) {
				// An unknown data type id and the ECG upper-bound rule both arrive as
				// plain errors from the filter builder, and both are things the caller
				// can fix. Everything here goes back as text rather than as a protocol
				// fault, so the model reads the reason and retries differently.
				//
				// Granted scopes are only worth fetching for a refusal from Google;
				// they cost nothing when the token already resolved, but asking for
				// them is pointless when it was the token itself that failed.
				const grantedScopes =
					error instanceof GoogleHealthApiError
						? await client.grantedScopes().catch(() => [])
						: [];

				log.warn("read failed", {
					dataType,
					status: error instanceof GoogleHealthApiError ? error.status : null,
					error: error instanceof Error ? error.message : String(error),
				});
				return text(describeApiError(error, grantedScopes), true);
			}
		},
	);

	server.registerTool(
		"get_health_profile",
		{
			title: "Get health profile",
			description:
				"The user's Google Health profile and app settings — date of birth, " +
				"height, biological sex, unit preferences. Useful for interpreting " +
				"the numbers `read_health_data` returns.",
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		async () => {
			const client = clientFor("get_health_profile");
			if (!client) return text(unauthorizedMessage(), true);

			try {
				// Settings are a separate grant from the profile, so a user may have
				// one and not the other. Failing the whole tool over the optional
				// half would be worse than reporting what was readable.
				const [profile, settings] = await Promise.all([
					client.getProfile(),
					client.getSettings().catch(() => null),
				]);

				return json({ profile, settings });
			} catch (error) {
				log.warn("profile read failed", {
					error: error instanceof Error ? error.message : String(error),
				});
				return text(describeApiError(error, []), true);
			}
		},
	);

	return server;
}
