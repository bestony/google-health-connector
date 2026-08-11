import { describe, expect, it } from "vitest";
import { MCP_OAUTH_SCOPE } from "./mcp/oauth-scopes";
import {
	OAUTH_GRANT_TOKEN_MODELS,
	oauthGrantTokenWhere,
	summarizeOAuthGrants,
} from "./oauth-grant-summary";

describe("OAuth grant summaries", () => {
	it("sorts newest first and uses the consent screen's scope wording", () => {
		const summaries = summarizeOAuthGrants([
			{
				id: "older",
				clientId: "client-1",
				clientName: "First app",
				redirectUris: ["https://first.example/callback"],
				scopes: ["openid"],
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				id: "newer",
				clientId: "client-2",
				clientName: "  Health reader  ",
				redirectUris: ["https://reader.example/callback"],
				scopes: [MCP_OAUTH_SCOPE, "custom:scope"],
				createdAt: new Date("2026-02-01T00:00:00.000Z"),
			},
		]);

		expect(summaries.map((grant) => grant.id)).toEqual(["newer", "older"]);
		expect(summaries[0]).toMatchObject({
			clientName: "Health reader",
			redirectUris: ["https://reader.example/callback"],
			approvedAt: "2026-02-01T00:00:00.000Z",
		});
		expect(summaries[0]?.scopes).toEqual([
			expect.objectContaining({ scope: MCP_OAUTH_SCOPE, known: true }),
			expect.objectContaining({ scope: "custom:scope", known: false }),
		]);
	});

	it("normalizes adapter strings, removes duplicates and supplies fallbacks", () => {
		const [summary] = summarizeOAuthGrants([
			{
				id: "grant-1",
				clientId: "client-1",
				clientName: "   ",
				redirectUris:
					'["https://client.example/callback","https://client.example/callback","  ",4]',
				scopes: "openid  email openid",
				createdAt: new Date("2026-03-01T00:00:00.000Z"),
			},
		]);

		expect(summary).toMatchObject({
			clientName: "client-1",
			redirectUris: ["https://client.example/callback"],
		});
		expect(summary?.scopes.map((scope) => scope.scope)).toEqual([
			"openid",
			"email",
		]);
	});

	it("keeps malformed or absent optional lists harmless", () => {
		const summaries = summarizeOAuthGrants([
			{
				id: "b",
				clientId: "client-b",
				redirectUris: "[not-json]",
				scopes: null,
				createdAt: new Date("2026-04-01T00:00:00.000Z"),
			},
			{
				id: "a",
				clientId: "client-a",
				redirectUris: [null, 4, {}],
				scopes: ["openid", null, 4],
				createdAt: new Date("2026-04-01T00:00:00.000Z"),
			},
		]);

		expect(summaries.map((grant) => grant.id)).toEqual(["a", "b"]);
		expect(summaries[0]?.redirectUris).toEqual([]);
		expect(summaries[1]?.redirectUris).toEqual(["[not-json]"]);
		expect(summaries[1]?.scopes).toEqual([]);
	});
});

describe("OAuth grant token cleanup", () => {
	it("targets both installed token models for one user and client", () => {
		expect(OAUTH_GRANT_TOKEN_MODELS).toEqual([
			"oauthAccessToken",
			"oauthRefreshToken",
		]);
		expect(oauthGrantTokenWhere("user-1", "client-1")).toEqual([
			{ field: "userId", value: "user-1" },
			{ field: "clientId", value: "client-1" },
		]);
	});
});
