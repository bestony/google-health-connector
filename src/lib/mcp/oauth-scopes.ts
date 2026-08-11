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

/** Permission to read the connected user's Google Health data through MCP. */
export const MCP_OAUTH_SCOPE = "health:read";

/** Every scope the authorization server advertises to OAuth clients. */
export const MCP_OAUTH_SCOPES = [
	"openid",
	"profile",
	"email",
	"offline_access",
	MCP_OAUTH_SCOPE,
] as const;

const TRAILING_SLASHES = /\/+$/;

/** Absolute URI of the MCP protected resource for one deployment. */
export function mcpResourceUri(baseUrl: string): string {
	return `${baseUrl.replace(TRAILING_SLASHES, "")}/mcp`;
}

/**
 * Audiences accepted for an MCP token.
 *
 * RFC 8707 permits a resource URI at either granularity. MCP clients in the
 * field use both the endpoint URI and its origin, so the authorization server
 * must recognize both while the resource server applies its own exact checks.
 */
export function mcpOAuthAudiences(baseUrl: string): string[] {
	const canonicalBaseUrl = baseUrl.replace(TRAILING_SLASHES, "");
	return [mcpResourceUri(canonicalBaseUrl), canonicalBaseUrl];
}
