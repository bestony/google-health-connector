import { getAuthBaseUrl } from "../env.server";
import {
	createGoogleHealthClient,
	GoogleHealthApiError,
} from "../google-health-api.server";
import { GoogleHealthAuthorizationError } from "../google-health-token.server";
import { createLogger } from "../logger.server";
import { type McpIdentity, mcpIdentityHasScope } from "./credential";
import {
	type ClampedWindow,
	readableCategories,
	scopeCategory,
} from "./health";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";

/**
 * What every health tool needs before it can do its own work: a result in the
 * protocol's shape, a refusal for a token without the scope, a Google failure
 * phrased so a model can act on it, and the note a clamped window owes.
 *
 * Split from `server.ts` so that module stays an assembly — which tools exist
 * and how they are described — while each tool's orchestration lives beside
 * it. Nothing here registers anything.
 */

const log = createLogger("mcp:server");
const TRAILING_SLASHES = /\/+$/;

/** Dashboard for resolving a missing or revoked Google Health connection. */
function dashboardUrl(): string {
	return `${getAuthBaseUrl().replace(TRAILING_SLASHES, "")}/dashboard`;
}

/** A tool result carrying text. */
export function text(body: string, isError = false) {
	return { content: [{ type: "text" as const, text: body }], isError };
}

/** A tool result carrying JSON, which is what these tools mostly return. */
export function json(payload: unknown) {
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
export function describeApiError(
	error: unknown,
	grantedScopes: readonly string[],
): string {
	// The likeliest failure of all, and it happens before Google is even called:
	// the user has a valid MCP credential but never authorized Google Health, or
	// revoked it since. On its own the message says what is wrong and not where
	// to fix it.
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

export function missingScope(identity: McpIdentity, tool: string) {
	if (mcpIdentityHasScope(identity, MCP_OAUTH_SCOPE)) return null;
	log.warn("refused tool: missing oauth scope", {
		tool,
		userId: identity.userId,
		clientId: identity.via === "oauth" ? identity.clientId : null,
		requiredScope: MCP_OAUTH_SCOPE,
	});
	return text(
		`This OAuth access token is missing the required ${MCP_OAUTH_SCOPE} scope.`,
		true,
	);
}

export function clientFor(identity: McpIdentity) {
	return createGoogleHealthClient({ userId: identity.userId });
}

export type ReadRangeResult =
	| { ok: true; from?: Date; to?: Date }
	| { ok: false; response: ReturnType<typeof text> };

export function parseReadRange(
	from: string | undefined,
	to: string | undefined,
): ReadRangeResult {
	const parsedFrom = from === undefined ? undefined : new Date(from);
	const parsedTo = to === undefined ? undefined : new Date(to);
	for (const [label, value] of [
		["from", parsedFrom],
		["to", parsedTo],
	] as const) {
		if (value !== undefined && Number.isNaN(value.getTime())) {
			return {
				ok: false,
				response: text(
					`\`${label}\` is not a date this server can read. Use RFC 3339, e.g. 2026-08-01T00:00:00Z.`,
					true,
				),
			};
		}
	}
	return { ok: true, from: parsedFrom, to: parsedTo };
}

export async function readHealthDataFailure(
	error: unknown,
	client: ReturnType<typeof clientFor>,
	dataType: string,
) {
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

/** A day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The one sentence a clamped window owes its caller. */
export function clampNote(window: ClampedWindow): string | undefined {
	return window.clamped
		? `Your requested start was earlier than this account's ${window.limitDays}-day history window, so it was moved forward. Older data was not searched.`
		: undefined;
}
