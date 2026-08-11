import { describe, expect, it } from "vitest";
import {
	buildMcpWwwAuthenticate,
	classifyBearerCredential,
	consentScopesInclude,
	describeCredentialRejection,
	extractMcpCredential,
	mcpIdentityHasScope,
	mcpResourceMetadataUrl,
	readUnverifiedJwtRoutingClaims,
} from "./credential";
import { MCP_OAUTH_SCOPE } from "./oauth-scopes";

function request(headers?: HeadersInit): Request {
	return new Request("https://health.example/mcp", { headers });
}

/** Mirrors the MCP SDK's field extraction regex in client/auth.js. */
function sdkExtract(header: string, fieldName: string): string | undefined {
	const [type, scheme] = header.split(" ");
	if (type.toLowerCase() !== "bearer" || !scheme) return undefined;
	const pattern = new RegExp(`${fieldName}=(?:"([^"]+)"|([^\\s,]+))`);
	const match = header.match(pattern);
	return match?.[1] || match?.[2] || undefined;
}

function compactJwt(payload: unknown): string {
	const json = JSON.stringify(payload);
	const encoded = globalThis
		.btoa(json)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
	return `header.${encoded}.signature`;
}

describe("MCP credential decisions", () => {
	it.each([
		["ghc_secret", "api-key"],
		["ghc_a.b.c", "api-key"],
		["header.payload.signature", "oauth"],
		["", "unknown"],
		["garbage", "unknown"],
		["header.payload", "unknown"],
		["header.payload.signature.extra", "unknown"],
		["header..signature", "unknown"],
		["header.payload=signature", "unknown"],
	] as const)("classifies %j as %s", (value, expected) => {
		expect(classifyBearerCredential(value)).toBe(expected);
	});

	it("extracts Bearer credentials case-insensitively with whitespace", () => {
		expect(
			extractMcpCredential(
				request({ authorization: "  bEaReR   ghc_secret   " }),
			),
		).toEqual({
			outcome: "credential",
			credential: { kind: "api-key", value: "ghc_secret" },
		});
		expect(
			extractMcpCredential(
				request({ authorization: "Bearer header.payload.signature" }),
			),
		).toEqual({
			outcome: "credential",
			credential: { kind: "oauth", value: "header.payload.signature" },
		});
	});

	it("accepts x-api-key only as an API key and trims it", () => {
		expect(
			extractMcpCredential(request({ "x-api-key": " ghc_secret " })),
		).toEqual({
			outcome: "credential",
			credential: { kind: "api-key", value: "ghc_secret" },
		});
		expect(
			extractMcpCredential(request({ "x-api-key": "legacy-key" })),
		).toEqual({
			outcome: "credential",
			credential: { kind: "api-key", value: "legacy-key" },
		});
		expect(
			extractMcpCredential(
				request({ "x-api-key": "header.payload.signature" }),
			),
		).toEqual({
			outcome: "rejected",
			kind: "oauth",
			reason: "oauth-in-api-key-header",
		});
	});

	it("does not demote malformed Authorization headers to anonymous", () => {
		expect(
			extractMcpCredential(
				request({ authorization: "DPoP xyz", "x-api-key": "ghc_valid" }),
			),
		).toEqual({
			outcome: "rejected",
			kind: "unknown",
			reason: "unsupported-authorization-scheme",
		});
		expect(
			extractMcpCredential(request({ authorization: "Bearer opaque-token" })),
		).toEqual({
			outcome: "rejected",
			kind: "unknown",
			reason: "opaque-bearer",
		});
		expect(extractMcpCredential(request({ authorization: "Bearer" }))).toEqual({
			outcome: "rejected",
			kind: "unknown",
			reason: "opaque-bearer",
		});
	});

	it("describes every extraction refusal without exposing a credential", () => {
		expect(
			describeCredentialRejection(
				{
					outcome: "rejected",
					kind: "unknown",
					reason: "opaque-bearer",
				},
				"https://health.example/base",
			),
		).toEqual({
			code: "OPAQUE_TOKEN",
			message:
				"This server accepts only JWT access tokens. Request one from the " +
				"token endpoint with resource=https://health.example/mcp.",
		});
		expect(
			describeCredentialRejection(
				{
					outcome: "rejected",
					kind: "oauth",
					reason: "oauth-in-api-key-header",
				},
				"https://health.example",
			),
		).toEqual({
			code: "OAUTH_TOKEN_IN_API_KEY_HEADER",
			message:
				"OAuth access tokens must use Authorization: Bearer <token>, not x-api-key.",
		});
		expect(
			describeCredentialRejection(
				{
					outcome: "rejected",
					kind: "unknown",
					reason: "unsupported-authorization-scheme",
				},
				"https://health.example",
			),
		).toEqual({
			code: "UNSUPPORTED_AUTHORIZATION_SCHEME",
			message: "Authorization must use the Bearer scheme.",
		});
	});

	it("treats absent and empty x-api-key headers as credential-less", () => {
		expect(extractMcpCredential(request())).toEqual({ outcome: "none" });
		expect(extractMcpCredential(request({ "x-api-key": "   " }))).toEqual({
			outcome: "none",
		});
	});

	it("builds challenges that the MCP SDK extraction regex can read", () => {
		const bare = buildMcpWwwAuthenticate("https://health.example/base");
		expect(bare).toMatch(/^Bearer realm="mcp",/);
		expect(sdkExtract(bare, "resource_metadata")).toBe(
			"https://health.example/.well-known/oauth-protected-resource/mcp",
		);
		expect(sdkExtract(bare, "scope")).toBe(MCP_OAUTH_SCOPE);
		expect(sdkExtract(bare, "error")).toBeUndefined();

		const rejected = buildMcpWwwAuthenticate("https://health.example", {
			error: "invalid_token",
			description: 'Line one\n"opaque" \\ token',
		});
		expect(sdkExtract(rejected, "error")).toBe("invalid_token");
		expect(sdkExtract(rejected, "error_description")).toBe(
			"Line one 'opaque'   token",
		);
		expect(sdkExtract(rejected, "error")).not.toBe(
			sdkExtract(rejected, "error_description"),
		);
	});

	it("builds the path-inserted protected-resource metadata URL", () => {
		expect(mcpResourceMetadataUrl("https://health.example///path")).toBe(
			"https://health.example/.well-known/oauth-protected-resource/mcp",
		);
	});

	it("treats API keys as unscoped and OAuth identities as scoped", () => {
		expect(
			mcpIdentityHasScope(
				{
					authenticated: true,
					userId: "user-1",
					keyId: "key-1",
				},
				"anything",
			),
		).toBe(true);
		expect(
			mcpIdentityHasScope(
				{
					authenticated: true,
					via: "oauth",
					userId: "user-1",
					clientId: "client-1",
					scopes: [MCP_OAUTH_SCOPE],
				},
				MCP_OAUTH_SCOPE,
			),
		).toBe(true);
		expect(
			mcpIdentityHasScope(
				{
					authenticated: true,
					via: "oauth",
					userId: "user-1",
					clientId: "client-1",
					scopes: ["openid"],
				},
				MCP_OAUTH_SCOPE,
			),
		).toBe(false);
	});

	it("checks consent scope arrays defensively", () => {
		expect(consentScopesInclude([MCP_OAUTH_SCOPE], MCP_OAUTH_SCOPE)).toBe(true);
		expect(consentScopesInclude([MCP_OAUTH_SCOPE, 1], MCP_OAUTH_SCOPE)).toBe(
			false,
		);
		expect(consentScopesInclude(MCP_OAUTH_SCOPE, MCP_OAUTH_SCOPE)).toBe(false);
	});

	it("reads only unverified issuer and audience claims for diagnostics", () => {
		expect(
			readUnverifiedJwtRoutingClaims(
				compactJwt({
					iss: "https://issuer.example",
					aud: ["https://health.example/mcp", "userinfo"],
					sub: "must-not-be-returned",
				}),
			),
		).toEqual({
			issuer: "https://issuer.example",
			audience: ["https://health.example/mcp", "userinfo"],
		});
		expect(
			readUnverifiedJwtRoutingClaims(compactJwt({ iss: 1, aud: "one" })),
		).toEqual({ issuer: null, audience: "one" });
		expect(
			readUnverifiedJwtRoutingClaims(compactJwt({ aud: ["one", 2] })),
		).toEqual({ issuer: null, audience: null });
		expect(readUnverifiedJwtRoutingClaims(compactJwt(null))).toEqual({
			issuer: null,
			audience: null,
		});
		expect(readUnverifiedJwtRoutingClaims("not-a-jwt")).toEqual({
			issuer: null,
			audience: null,
		});
		expect(readUnverifiedJwtRoutingClaims("a.@@@.c")).toEqual({
			issuer: null,
			audience: null,
		});
	});
});
