import { describe, expect, it } from "vitest";
import {
	OAUTH_METADATA_CORS_HEADERS,
	oauthMetadataHeadResponse,
	oauthMetadataOptionsResponse,
	oauthMetadataUnavailableResponse,
	protectedResourceMetadataResponse,
} from "./oauth-metadata";

describe("OAuth metadata responses", () => {
	it("builds a browser-readable protected-resource document", async () => {
		const response = protectedResourceMetadataResponse(
			"https://health.example",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Content-Type")).toContain("application/json");
		expect(await response.json()).toMatchObject({
			resource: "https://health.example/mcp",
			authorization_servers: ["https://health.example"],
		});
	});

	it("returns CORS preflight and fail-closed responses", async () => {
		const options = oauthMetadataOptionsResponse();
		expect(options.status).toBe(204);
		expect(options.headers.get("Access-Control-Allow-Methods")).toBe(
			OAUTH_METADATA_CORS_HEADERS["Access-Control-Allow-Methods"],
		);

		const unavailable = oauthMetadataUnavailableResponse();
		expect(unavailable.status).toBe(404);
		expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
		expect(await unavailable.json()).toEqual({ error: "Not found" });
	});

	it("preserves metadata status and headers while removing a HEAD body", async () => {
		const response = protectedResourceMetadataResponse(
			"https://health.example",
		);
		const head = oauthMetadataHeadResponse(response);
		expect(head.status).toBe(200);
		expect(head.headers.get("Content-Type")).toContain("application/json");
		expect(await head.text()).toBe("");
	});
});
