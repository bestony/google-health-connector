import { API_KEY_HEADER } from "../api-key-config";
import { getAuth } from "../auth.server";
import { createLogger } from "../logger.server";

/**
 * Who is on the other end of an MCP request.
 *
 * The endpoint is deliberately open to anonymous callers: a client may connect,
 * `initialize` and list what is on offer without holding anything, because
 * discovery is how a user decides whether to bother getting a key at all.
 * Invoking is what needs one. `server.ts` is where that line is drawn — this
 * module only answers who is calling.
 */

const log = createLogger("mcp:auth");

export type McpIdentity =
	/** No credential presented. Discovery only. */
	| { authenticated: false }
	/** A key was presented and it checks out. */
	| { authenticated: true; userId: string; keyId: string };

/** Why a presented key was refused. Distinguishes 401 from "no key at all". */
export type McpAuthFailure = { code: string; message: string };

export type McpAuthResult =
	| { outcome: "anonymous" }
	| { outcome: "authenticated"; identity: McpIdentity }
	| { outcome: "rejected"; failure: McpAuthFailure };

/** `Bearer <token>`, case-insensitively, with the token unpadded. */
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Pull the key out of the request.
 *
 * `Authorization: Bearer` first, because it is the header MCP clients can set
 * without extra configuration and therefore the one the docs tell users about.
 * `x-api-key` is the plugin's own default and what a `curl` example reaches
 * for, so it is accepted too rather than being a silent dead end.
 */
export function extractApiKey(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	const bearer = authorization?.match(BEARER_PATTERN)?.[1]?.trim();
	if (bearer) return bearer;

	return request.headers.get(API_KEY_HEADER)?.trim() || null;
}

/**
 * Resolve the caller.
 *
 * Three outcomes, not two: a request with no credential is anonymous and
 * proceeds, while a request carrying a credential that does not check out is
 * *rejected*. Quietly demoting a bad key to anonymous would turn a typo — or an
 * expired key, or one the user just revoked — into a client that appears to work
 * until the first tool call comes back refusing to run, which is a far harder
 * thing to debug than a 401.
 */
export async function authenticateMcpRequest(
	request: Request,
): Promise<McpAuthResult> {
	const key = extractApiKey(request);

	if (key === null) {
		log.debug("anonymous request");
		return { outcome: "anonymous" };
	}

	let result: Awaited<
		ReturnType<ReturnType<typeof getAuth>["api"]["verifyApiKey"]>
	>;
	try {
		// Verification also enforces the key's rate limit and its enabled flag, so
		// this is the whole check, not just a lookup.
		result = await getAuth().api.verifyApiKey({ body: { key } });
	} catch (error) {
		log.error("api key verification failed", {
			error: error instanceof Error ? error.message : String(error),
		});
		return {
			outcome: "rejected",
			failure: { code: "VERIFICATION_FAILED", message: "Could not verify key" },
		};
	}

	if (!result.valid || result.key === null) {
		// The plugin's reason (expired, disabled, rate limited, unknown) is worth
		// logging, but it is not worth telling an unauthenticated caller which of
		// those it was.
		log.warn("rejected api key", {
			code: result.error?.code ?? null,
			message: result.error?.message ?? null,
		});
		return {
			outcome: "rejected",
			failure: {
				code: result.error?.code ?? "INVALID_API_KEY",
				message: "Invalid API key",
			},
		};
	}

	// `referenceId` is the owning user's id — the plugin's generic name for it,
	// since a key can just as well belong to an organization.
	const identity: McpIdentity = {
		authenticated: true,
		userId: result.key.referenceId,
		keyId: result.key.id,
	};

	log.debug("authenticated request", {
		userId: identity.userId,
		keyId: identity.keyId,
	});

	return { outcome: "authenticated", identity };
}
