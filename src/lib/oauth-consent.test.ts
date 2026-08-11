import { describe, expect, it } from "vitest";
import { MCP_OAUTH_SCOPE } from "./mcp/oauth-scopes";
import {
	describeConsentScopes,
	parseConsentRequest,
	requestsGoogleHealthData,
	validateConsentSearch,
} from "./oauth-consent";

describe("OAuth consent query", () => {
	it("parses a well-formed signed search string", () => {
		expect(
			parseConsentRequest(
				`?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=openid%20${encodeURIComponent(MCP_OAUTH_SCOPE)}&sig=signed`,
			),
		).toEqual({
			status: "ready",
			signed: true,
			clientId: "client-1",
			redirectUri: "https://client.example/callback",
			scopes: ["openid", MCP_OAUTH_SCOPE],
		});
	});

	it("refuses a signed query with no client id", () => {
		expect(parseConsentRequest("?scope=openid&sig=signed")).toEqual({
			status: "invalid",
			signed: true,
			reason: "missing-client-id",
			clientId: null,
			redirectUri: null,
			scopes: ["openid"],
		});
	});

	it("marks a query with no signature as unsigned", () => {
		expect(parseConsentRequest("?client_id=client-1&scope=openid")).toEqual({
			status: "unsigned",
			signed: false,
			clientId: "client-1",
			redirectUri: null,
			scopes: ["openid"],
		});
	});

	it("uses an empty scope list when scope is absent", () => {
		const request = parseConsentRequest("?client_id=client-1&sig=signed");
		expect(request.scopes).toEqual([]);
	});

	it("retains every installed provider field and repeated signed names", () => {
		const validated = validateConsentSearch({
			client_id: "client-1",
			request_uri: "urn:request:1",
			display: "popup",
			ui_locales: "en",
			max_age: 0,
			acr_values: "bronze",
			login_hint: "person@example.com",
			id_token_hint: "hint",
			ba_pl: "session-1",
			ba_param: ["extension", "ba_param"],
			extension: "kept",
			unsigned_extension: "dropped",
			sig: "signed",
		});

		expect(validated).toMatchObject({
			client_id: "client-1",
			request_uri: "urn:request:1",
			display: "popup",
			ui_locales: "en",
			max_age: 0,
			acr_values: "bronze",
			login_hint: "person@example.com",
			id_token_hint: "hint",
			ba_pl: "session-1",
			ba_param: ["extension", "ba_param"],
			extension: "kept",
			sig: "signed",
		});
		expect(validated.unsigned_extension).toBeUndefined();
	});

	it("preserves safe primitive extensions and rejects unsafe object keys", () => {
		const search: Record<string, unknown> = Object.create(null);
		search.client_id = "client-1";
		search.sig = "signed";
		search.ba_param = ["__proto__", "extension", "empty", 42, true, null];
		search.__proto__ = "blocked";
		search.extension = ["one", false, 2, null, {}];
		search.empty = [null, {}];
		search["42"] = 42;
		search.true = true;

		const validated = validateConsentSearch(search);
		expect(validated.__proto__).not.toBe("blocked");
		expect(validated.extension).toEqual(["one", false, 2]);
		expect(validated.empty).toBeUndefined();
		expect(validated["42"]).toBe(42);
		expect(validated.true).toBe(true);
		expect(parseConsentRequest(validated)).toMatchObject({
			status: "ready",
			clientId: "client-1",
			signed: true,
		});
	});

	it("uses the first value when a query parameter is repeated", () => {
		expect(
			parseConsentRequest(
				"?client_id=client-1&sig=signed&scope=openid&scope=email",
			).scopes,
		).toEqual(["openid"]);
	});
});

describe("OAuth consent scope copy", () => {
	it("falls back to an unknown scope's raw string", () => {
		expect(describeConsentScopes(["custom:scope"])).toEqual([
			{
				scope: "custom:scope",
				label: "custom:scope",
				description: "A capability requested by this OAuth client.",
				known: false,
			},
		]);
	});

	it("recognizes the Google Health MCP scope", () => {
		expect(requestsGoogleHealthData(["openid", MCP_OAUTH_SCOPE])).toBe(true);
		expect(requestsGoogleHealthData(["openid"])).toBe(false);
		expect(describeConsentScopes([MCP_OAUTH_SCOPE])[0]).toMatchObject({
			scope: MCP_OAUTH_SCOPE,
			known: true,
		});
	});
});
