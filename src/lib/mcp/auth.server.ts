import { verifyBearerToken } from "better-auth/oauth2";
import { getAuth } from "../auth.server";
import { getAuthBaseUrl, isMcpOAuthEnabled } from "../env.server";
import { createLogger } from "../logger.server";
import {
	consentScopesInclude,
	describeCredentialRejection,
	extractMcpCredential,
	type McpCredentialKind,
	type McpIdentity,
	mcpIdentityHasScope,
	readUnverifiedJwtRoutingClaims,
} from "./credential";
import {
	MCP_OAUTH_SCOPE,
	mcpResourceUri,
	oauthIssuer,
	oauthJwksUrl,
} from "./oauth-scopes";

/** One HTTP-authentication refusal safe to return to an unauthenticated client. */
export type McpAuthFailure = {
	status: 401 | 403;
	code: string;
	error: "insufficient_scope" | "invalid_token";
	message: string;
	credentialKind: McpCredentialKind;
};

export type McpAuthResult =
	| { outcome: "anonymous" }
	| { outcome: "authenticated"; identity: McpIdentity }
	| { outcome: "rejected"; failure: McpAuthFailure }
	| { outcome: "error"; code: string };

export type { McpIdentity } from "./credential";

type AccessTokenClaims = Awaited<ReturnType<typeof verifyBearerToken>>;

const log = createLogger("mcp:auth");
const SCOPE_SEPARATOR = /\s+/;

function rejected(
	credentialKind: McpCredentialKind,
	code: string,
	message: string,
	options?: {
		status: 401 | 403;
		error: "insufficient_scope" | "invalid_token";
	},
): McpAuthResult {
	return {
		outcome: "rejected",
		failure: {
			status: options?.status ?? 401,
			code,
			error: options?.error ?? "invalid_token",
			message,
			credentialKind,
		},
	};
}

async function authenticateApiKey(key: string): Promise<McpAuthResult> {
	let result: Awaited<
		ReturnType<ReturnType<typeof getAuth>["api"]["verifyApiKey"]>
	>;
	try {
		// Verification also enforces the key's rate limit and enabled flag.
		result = await getAuth().api.verifyApiKey({ body: { key } });
	} catch (error) {
		log.error("api key verification failed", {
			kind: "api-key",
			error: error instanceof Error ? error.message : String(error),
		});
		return { outcome: "error", code: "API_KEY_VERIFICATION_FAILED" };
	}

	if (!result.valid || result.key === null) {
		log.warn("rejected api key", {
			kind: "api-key",
			code: result.error?.code ?? null,
			message: result.error?.message ?? null,
		});
		return rejected(
			"api-key",
			result.error?.code ?? "INVALID_API_KEY",
			"Invalid API key.",
		);
	}

	const identity: McpIdentity = {
		authenticated: true,
		via: "api-key",
		userId: result.key.referenceId,
		keyId: result.key.id,
	};
	log.debug("authenticated request", {
		kind: "api-key",
		userId: identity.userId,
		keyId: identity.keyId,
	});
	return { outcome: "authenticated", identity };
}

async function verifyOAuthClaims(
	token: string,
	baseUrl: string,
): Promise<
	| { outcome: "verified"; claims: AccessTokenClaims }
	| { outcome: "failed"; result: McpAuthResult }
> {
	const expectedIssuer = oauthIssuer(baseUrl);
	const expectedAudience = mcpResourceUri(baseUrl);
	try {
		return {
			outcome: "verified",
			claims: await verifyBearerToken(token, {
				jwksUrl: oauthJwksUrl(baseUrl),
				verifyOptions: {
					issuer: expectedIssuer,
					audience: expectedAudience,
				},
			}),
		};
	} catch (error) {
		const routingClaims = readUnverifiedJwtRoutingClaims(token);
		const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
		log.warn("oauth token verification failed", {
			kind: "oauth",
			expectedIssuer,
			expectedAudience,
			presentedIssuer: routingClaims.issuer,
			presentedAudience: routingClaims.audience,
			statusCode: typeof statusCode === "number" ? statusCode : null,
			error: error instanceof Error ? error.message : String(error),
		});
		if (statusCode !== 401 && statusCode !== 403) {
			return {
				outcome: "failed",
				result: { outcome: "error", code: "OAUTH_VERIFICATION_FAILED" },
			};
		}
		const expired = error instanceof Error && error.message === "token expired";
		return {
			outcome: "failed",
			result: rejected(
				"oauth",
				expired ? "EXPIRED_OAUTH_TOKEN" : "INVALID_OAUTH_TOKEN",
				expired ? "OAuth access token expired." : "Invalid OAuth access token.",
			),
		};
	}
}

function identityFromClaims(
	claims: AccessTokenClaims,
): Extract<McpIdentity, { via: "oauth" }> | null {
	const userId = typeof claims.sub === "string" ? claims.sub.trim() : "";
	const rawClientId = claims.client_id ?? claims.azp;
	const clientId = typeof rawClientId === "string" ? rawClientId.trim() : "";
	if (userId === "" || clientId === "") return null;
	const scopes =
		typeof claims.scope === "string"
			? claims.scope.split(SCOPE_SEPARATOR).filter(Boolean)
			: [];
	return {
		authenticated: true,
		via: "oauth",
		userId,
		clientId,
		scopes,
	};
}

async function oauthConsentIsLive(
	identity: Extract<McpIdentity, { via: "oauth" }>,
) {
	// The consent grant, not the browser session named by `sid`, owns liveness.
	// Requiring a session row here would silently cap every OAuth connection at
	// the seven-day web-session lifetime; signing out must not revoke the grant.
	const context = await getAuth().$context;
	const consent = await context.adapter.findOne<{ scopes: unknown }>({
		model: "oauthConsent",
		where: [
			{ field: "userId", value: identity.userId },
			{ field: "clientId", value: identity.clientId },
		],
		select: ["scopes"],
	});
	return consentScopesInclude(consent?.scopes, MCP_OAUTH_SCOPE);
}

async function authenticateOAuthToken(token: string): Promise<McpAuthResult> {
	const baseUrl = getAuthBaseUrl();
	if (!isMcpOAuthEnabled()) {
		return rejected(
			"oauth",
			"OAUTH_DISABLED",
			"OAuth access tokens are not enabled on this deployment.",
		);
	}

	const verified = await verifyOAuthClaims(token, baseUrl);
	if (verified.outcome === "failed") return verified.result;
	const identity = identityFromClaims(verified.claims);
	if (identity === null) {
		log.warn("oauth token is missing identity claims", { kind: "oauth" });
		return rejected(
			"oauth",
			"INVALID_OAUTH_CLAIMS",
			"OAuth access token is missing its user or client identity.",
		);
	}
	if (!mcpIdentityHasScope(identity, MCP_OAUTH_SCOPE)) {
		return rejected(
			"oauth",
			"INSUFFICIENT_SCOPE",
			`OAuth access token is missing the required ${MCP_OAUTH_SCOPE} scope.`,
			{ status: 403, error: "insufficient_scope" },
		);
	}

	try {
		if (!(await oauthConsentIsLive(identity))) {
			log.warn("oauth grant is no longer live", {
				kind: "oauth",
				userId: identity.userId,
				clientId: identity.clientId,
			});
			return rejected(
				"oauth",
				"REVOKED_OAUTH_GRANT",
				"The OAuth grant for this client is no longer active.",
			);
		}
	} catch (error) {
		log.error("oauth consent liveness check failed", {
			kind: "oauth",
			error: error instanceof Error ? error.message : String(error),
		});
		return { outcome: "error", code: "OAUTH_LIVENESS_CHECK_FAILED" };
	}

	log.debug("authenticated request", {
		kind: "oauth",
		userId: identity.userId,
		clientId: identity.clientId,
	});
	return { outcome: "authenticated", identity };
}

/** Resolve one credential into an identity without cookies or introspection. */
export async function authenticateMcpRequest(
	request: Request,
): Promise<McpAuthResult> {
	const extraction = extractMcpCredential(request);
	if (extraction.outcome === "none") {
		log.debug("classified request credential", { kind: "none" });
		return { outcome: "anonymous" };
	}
	if (extraction.outcome === "rejected") {
		log.debug("classified request credential", { kind: extraction.kind });
		const failure = describeCredentialRejection(extraction, getAuthBaseUrl());
		return rejected(failure.credentialKind, failure.code, failure.message);
	}

	log.debug("classified request credential", {
		kind: extraction.credential.kind,
	});
	return extraction.credential.kind === "api-key"
		? authenticateApiKey(extraction.credential.value)
		: authenticateOAuthToken(extraction.credential.value);
}
