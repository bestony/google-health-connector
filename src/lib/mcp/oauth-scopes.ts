/**
 * OAuth facts shared by the authorization server and MCP resource server.
 *
 * A scope or audience copied into both halves can drift without a type error:
 * the authorization server will still mint a token, but the resource server
 * will reject it. Keep the canonical values and their URL construction here.
 *
 * This module is pure data. Keep it free of imports so server configuration,
 * route metadata and browser consent copy can all use it.
 */

/** Path the MCP protected resource is mounted at. */
export const MCP_ENDPOINT_PATH = "/mcp";

/** Permission to read the connected user's Google Health data through MCP. */
export const MCP_OAUTH_SCOPE = "mcp:health:read";

/** Every scope the authorization server accepts and advertises to OAuth clients. */
export const MCP_OAUTH_ACCEPTED_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	MCP_OAUTH_SCOPE,
] as const;

/**
 * Scopes an MCP client should request from protected-resource metadata.
 *
 * Keep this narrower than the authorization-server documents. The MCP SDK
 * requests every scope listed by the protected resource, which would put
 * unrelated OIDC profile scopes on the MCP consent screen.
 */
export const MCP_OAUTH_RESOURCE_SCOPES = [
	MCP_OAUTH_SCOPE,
	"offline_access",
] as const;

const AUTH_BASE_PATH = "/api/auth";

const TRAILING_SLASHES = /\/+$/;

/** OAuth issuer for one deployment. It is always the bare public origin. */
export function oauthIssuer(baseUrl: string): string {
	return new URL(baseUrl).origin;
}

/** JWKS endpoint used to verify MCP JWT access tokens. */
export function oauthJwksUrl(baseUrl: string): string {
	return `${oauthIssuer(baseUrl)}${AUTH_BASE_PATH}/jwks`;
}

/** Absolute URI of the MCP protected resource for one deployment. */
export function mcpResourceUri(baseUrl: string): string {
	return `${oauthIssuer(baseUrl.replace(TRAILING_SLASHES, ""))}${MCP_ENDPOINT_PATH}`;
}

/**
 * Audiences accepted for an MCP token.
 *
 * RFC 8707 permits a resource URI at either granularity. MCP clients in the
 * field use both the endpoint URI and its origin, so the authorization server
 * must recognize both while the resource server applies its own exact checks.
 */
export function mcpOAuthAudiences(baseUrl: string): string[] {
	const issuer = oauthIssuer(baseUrl);
	return [mcpResourceUri(issuer), issuer];
}

/** Resource identifiers that can be requested during dynamic client registration. */
export function mcpOAuthResources(baseUrl: string): string[] {
	return [mcpResourceUri(baseUrl)];
}

/** RFC 9728 metadata shared by both protected-resource discovery paths. */
export function protectedResourceMetadata(baseUrl: string) {
	const issuer = oauthIssuer(baseUrl);
	return {
		resource: mcpResourceUri(issuer),
		authorization_servers: [issuer],
		scopes_supported: [...MCP_OAUTH_RESOURCE_SCOPES],
		bearer_methods_supported: ["header"],
	};
}
