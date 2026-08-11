import { API_KEY_HEADER, API_KEY_PREFIX } from "../api-key-config";
import {
	MCP_ENDPOINT_PATH,
	MCP_OAUTH_SCOPE,
	oauthIssuer,
} from "./oauth-scopes";

/** One verified caller. Anonymous requests never reach the MCP server. */
export type McpIdentity =
	| {
			authenticated: true;
			via?: "api-key";
			userId: string;
			keyId: string;
	  }
	| {
			authenticated: true;
			via: "oauth";
			userId: string;
			clientId: string;
			scopes: readonly string[];
	  };

export type McpCredential =
	| { kind: "api-key"; value: string }
	| { kind: "oauth"; value: string };

export type McpCredentialExtraction =
	| { outcome: "none" }
	| { outcome: "credential"; credential: McpCredential }
	| {
			outcome: "rejected";
			kind: "oauth" | "unknown";
			reason:
				| "opaque-bearer"
				| "oauth-in-api-key-header"
				| "unsupported-authorization-scheme";
	  };

export interface McpBearerChallengeError {
	error: "insufficient_scope" | "invalid_token";
	description: string;
}

export interface McpCredentialRejection {
	code: string;
	message: string;
}

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_AUTHORIZATION = /^\s*Bearer(?:\s+(.+?))?\s*$/i;

/** Classify only shapes this resource server knows how to verify. */
export function classifyBearerCredential(
	value: string,
): "api-key" | "oauth" | "unknown" {
	if (value.startsWith(API_KEY_PREFIX)) return "api-key";
	return COMPACT_JWS.test(value) ? "oauth" : "unknown";
}

/**
 * Extract one credential without ever demoting a malformed header to anonymous.
 *
 * `Authorization` takes precedence. A compact JWS in `x-api-key` is rejected
 * before API-key verification so an OAuth token cannot produce a misleading
 * API-key failure or a production error log from the API-key plugin.
 */
export function extractMcpCredential(
	request: Request,
): McpCredentialExtraction {
	const authorization = request.headers.get("authorization");
	if (authorization !== null) {
		const match = BEARER_AUTHORIZATION.exec(authorization);
		if (match === null) {
			return {
				outcome: "rejected",
				kind: "unknown",
				reason: "unsupported-authorization-scheme",
			};
		}

		const value = match[1]?.trim() ?? "";
		const kind = classifyBearerCredential(value);
		if (kind === "unknown") {
			return {
				outcome: "rejected",
				kind,
				reason: "opaque-bearer",
			};
		}
		return { outcome: "credential", credential: { kind, value } };
	}

	const apiKey = request.headers.get(API_KEY_HEADER)?.trim() ?? "";
	if (apiKey === "") return { outcome: "none" };
	if (classifyBearerCredential(apiKey) === "oauth") {
		return {
			outcome: "rejected",
			kind: "oauth",
			reason: "oauth-in-api-key-header",
		};
	}
	return {
		outcome: "credential",
		credential: { kind: "api-key", value: apiKey },
	};
}

/** Turn an extraction refusal into one actionable, credential-safe message. */
export function describeCredentialRejection(
	extraction: Extract<McpCredentialExtraction, { outcome: "rejected" }>,
	baseUrl: string,
): McpCredentialRejection {
	switch (extraction.reason) {
		case "opaque-bearer":
			return {
				code: "OPAQUE_TOKEN",
				message:
					"This server accepts only JWT access tokens. Request one from the " +
					`token endpoint with resource=${oauthIssuer(baseUrl)}${MCP_ENDPOINT_PATH}.`,
			};
		case "oauth-in-api-key-header":
			return {
				code: "OAUTH_TOKEN_IN_API_KEY_HEADER",
				message:
					"OAuth access tokens must use Authorization: Bearer <token>, not x-api-key.",
			};
		case "unsupported-authorization-scheme":
			return {
				code: "UNSUPPORTED_AUTHORIZATION_SCHEME",
				message: "Authorization must use the Bearer scheme.",
			};
	}
}

/** Protected-resource metadata URL advertised in every MCP auth challenge. */
export function mcpResourceMetadataUrl(baseUrl: string): string {
	return `${oauthIssuer(baseUrl)}/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}`;
}

/** Build a challenge in the exact shape the MCP SDK can parse. */
export function buildMcpWwwAuthenticate(
	baseUrl: string,
	failure?: McpBearerChallengeError,
): string {
	const parts = [
		'Bearer realm="mcp"',
		`resource_metadata="${mcpResourceMetadataUrl(baseUrl)}"`,
		`scope="${MCP_OAUTH_SCOPE}"`,
	];
	if (failure !== undefined) {
		const description = failure.description
			.replaceAll("\\", " ")
			.replaceAll('"', "'")
			.replaceAll("\r", " ")
			.replaceAll("\n", " ");
		parts.push(
			`error="${failure.error}"`,
			`error_description="${description}"`,
		);
	}
	return parts.join(", ");
}

/** API keys are owner credentials; OAuth identities carry only granted scopes. */
export function mcpIdentityHasScope(
	identity: McpIdentity,
	requiredScope: string,
): boolean {
	return identity.via !== "oauth" || identity.scopes.includes(requiredScope);
}

/** Fail closed when an adapter returns a malformed consent-scope value. */
export function consentScopesInclude(
	value: unknown,
	requiredScope: string,
): boolean {
	return (
		Array.isArray(value) &&
		value.every((scope) => typeof scope === "string") &&
		value.includes(requiredScope)
	);
}

/**
 * Read unverified routing claims for diagnostics after verification failed.
 *
 * These values never authorize anything. They only make issuer and audience
 * mismatches visible without logging the credential itself.
 */
export function readUnverifiedJwtRoutingClaims(token: string): {
	issuer: string | null;
	audience: string | readonly string[] | null;
} {
	try {
		const payloadSegment = token.split(".")[1];
		if (payloadSegment === undefined || payloadSegment === "") {
			return { issuer: null, audience: null };
		}
		const base64 = payloadSegment.replaceAll("-", "+").replaceAll("_", "/");
		const padded = base64.padEnd(
			base64.length + ((4 - (base64.length % 4)) % 4),
			"=",
		);
		const payload: unknown = JSON.parse(globalThis.atob(padded));
		if (typeof payload !== "object" || payload === null) {
			return { issuer: null, audience: null };
		}
		const claims = payload as { iss?: unknown; aud?: unknown };
		const issuer = typeof claims.iss === "string" ? claims.iss : null;
		const audience =
			typeof claims.aud === "string" ||
			(Array.isArray(claims.aud) &&
				claims.aud.every((entry) => typeof entry === "string"))
				? claims.aud
				: null;
		return { issuer, audience };
	} catch {
		return { issuer: null, audience: null };
	}
}
