import { describe, expect, it } from "vitest";
import {
	API_KEY_HEADER,
	API_KEY_PREFIX,
	API_KEY_RATE_LIMIT,
} from "./api-key-config";
import {
	GOOGLE_HEALTH_DATA_TYPES,
	GOOGLE_HEALTH_SCOPES,
	googleHealthScope,
	googleHealthScopesFor,
	isGoogleHealthScope,
} from "./google-health-scopes";
import {
	LEGAL,
	LEGAL_BILLING,
	LEGAL_CONTACT_MAILTO,
	LEGAL_LINKS,
	LEGAL_RETENTION,
} from "./legal";
import {
	MCP_ENDPOINT_PATH,
	MCP_OAUTH_ACCEPTED_SCOPES,
	MCP_OAUTH_RESOURCE_SCOPES,
	MCP_OAUTH_SCOPE,
	MCP_OAUTH_TOKEN_LIFETIME,
	mcpOAuthResources,
	mcpResourceUri,
	oauthIssuer,
	oauthJwksUrl,
	protectedResourceMetadata,
} from "./mcp/oauth-scopes";
import {
	FREE_HISTORY_DAYS,
	MCP_CLIENTS,
	PLANS,
	PRO_ANNUAL_SAVING_PERCENT,
	PRO_MONTHLY_PRICE,
	PRO_PRICE,
} from "./plans";

describe("shared product facts", () => {
	it("defines the API key contract", () => {
		expect(API_KEY_PREFIX).toBe("ghc_");
		expect(API_KEY_HEADER).toBe("x-api-key");
		expect(API_KEY_RATE_LIMIT).toEqual({
			timeWindow: 1_000,
			maxRequests: 10_000,
		});
	});

	it("derives all Google Health scope variants from the catalog", () => {
		const writable = GOOGLE_HEALTH_DATA_TYPES.find(
			(dataType) => dataType.writable,
		);
		const readOnly = GOOGLE_HEALTH_DATA_TYPES.find(
			(dataType) => !dataType.writable,
		);
		if (writable === undefined || readOnly === undefined) {
			throw new Error("scope catalog is missing a writable or read-only entry");
		}
		expect(googleHealthScope("sleep", "read")).toBe(
			"https://www.googleapis.com/auth/googlehealth.sleep.readonly",
		);
		expect(googleHealthScope("sleep", "write")).toContain("writeonly");
		expect(googleHealthScopesFor(writable)).toHaveLength(2);
		expect(googleHealthScopesFor(readOnly)).toHaveLength(1);
		expect(GOOGLE_HEALTH_SCOPES).toHaveLength(
			GOOGLE_HEALTH_DATA_TYPES.length +
				GOOGLE_HEALTH_DATA_TYPES.filter((dataType) => dataType.writable).length,
		);
		expect(isGoogleHealthScope(GOOGLE_HEALTH_SCOPES.at(0) ?? "")).toBe(true);
		expect(isGoogleHealthScope("openid")).toBe(false);
	});

	it("defines the MCP OAuth scope and canonical audiences", () => {
		expect(MCP_ENDPOINT_PATH).toBe("/mcp");
		expect(MCP_OAUTH_ACCEPTED_SCOPES).toEqual([
			"openid",
			"profile",
			"email",
			"offline_access",
			MCP_OAUTH_SCOPE,
		]);
		expect(MCP_OAUTH_RESOURCE_SCOPES).toEqual([
			MCP_OAUTH_SCOPE,
			"offline_access",
		]);
		expect(new Set(MCP_OAUTH_ACCEPTED_SCOPES).size).toBe(
			MCP_OAUTH_ACCEPTED_SCOPES.length,
		);
		expect(
			MCP_OAUTH_RESOURCE_SCOPES.every((scope) =>
				MCP_OAUTH_ACCEPTED_SCOPES.includes(scope),
			),
		).toBe(true);
		expect(MCP_OAUTH_RESOURCE_SCOPES).not.toContain("openid");
		expect(MCP_OAUTH_ACCEPTED_SCOPES).toContain("openid");
		expect(oauthIssuer("https://health.example/base/path")).toBe(
			"https://health.example",
		);
		expect(oauthJwksUrl("https://health.example/")).toBe(
			"https://health.example/api/auth/jwks",
		);
		expect(mcpResourceUri("https://health.example")).toBe(
			"https://health.example/mcp",
		);
		expect(mcpResourceUri("https://health.example///")).toBe(
			"https://health.example/mcp",
		);
		// The registry holds the endpoint URI only. Adding the bare origin would
		// let a client obtain a token whose `aud` /mcp then refuses.
		expect(mcpOAuthResources("https://health.example/")).toEqual([
			"https://health.example/mcp",
		]);

		const metadata = protectedResourceMetadata("https://health.example/");
		expect(metadata).toEqual({
			resource: "https://health.example/mcp",
			authorization_servers: ["https://health.example"],
			scopes_supported: [MCP_OAUTH_SCOPE, "offline_access"],
			bearer_methods_supported: ["header"],
		});
		expect(mcpOAuthResources("https://health.example")).toContain(
			metadata.resource,
		);
		expect(metadata.resource).toBe(mcpResourceUri("https://health.example"));
	});

	it("gives an MCP OAuth grant thirty days without a browser", () => {
		const thirtyDays = 60 * 60 * 24 * 30;
		expect(MCP_OAUTH_TOKEN_LIFETIME.accessTokenSeconds).toBe(thirtyDays);
		expect(MCP_OAUTH_TOKEN_LIFETIME.refreshTokenSeconds).toBe(thirtyDays);
		// A client that never refreshes must not run out before its refresh token
		// does, or the thirty days would only apply to well-behaved clients.
		expect(MCP_OAUTH_TOKEN_LIFETIME.accessTokenSeconds).toBeLessThanOrEqual(
			MCP_OAUTH_TOKEN_LIFETIME.refreshTokenSeconds,
		);
		// A grace window, not a second lifetime: it only replays one rotation.
		expect(MCP_OAUTH_TOKEN_LIFETIME.refreshTokenReuseSeconds).toBe(60);
		expect(
			MCP_OAUTH_TOKEN_LIFETIME.refreshTokenReuseSeconds,
		).toBeLessThanOrEqual(300);
	});

	it("keeps pricing and plan claims internally consistent", () => {
		expect(FREE_HISTORY_DAYS).toBe(90);
		expect(PRO_PRICE).toEqual({ amount: "$9.99", period: "year" });
		expect(PRO_MONTHLY_PRICE).toEqual({ amount: "$1.99", period: "month" });
		expect(PRO_ANNUAL_SAVING_PERCENT).toBe(58);
		expect(MCP_CLIENTS).toEqual(["Claude", "Grok", "ChatGPT"]);
		expect(PLANS.map((plan) => plan.id)).toEqual(["plan-free", "plan-pro"]);
		expect(PLANS.filter((plan) => plan.featured)).toHaveLength(1);
	});

	it("centralizes legal identity, retention and links", () => {
		expect(LEGAL.appName).toContain(LEGAL.productName);
		expect(LEGAL.appName).toContain(LEGAL.vendorName);
		expect(LEGAL_CONTACT_MAILTO).toBe(`mailto:${LEGAL.contactEmail}`);
		expect(LEGAL_RETENTION.deletionRequestDays).toBe(30);
		expect(LEGAL_BILLING.refundProcessingBusinessDays).toEqual({
			min: 5,
			max: 10,
		});
		expect(LEGAL_LINKS.googleLimitedUse).toContain("additional_requirements");
	});
});
