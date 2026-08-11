import { describe, expect, it } from "vitest";
import {
	acceptsHtml,
	replaceHtmlOnlyRefusal,
} from "./html-only-refusal.server";

const refusal = () =>
	new Response('{"error":"Only HTML requests are supported here"}', {
		status: 500,
		headers: { "content-type": "application/json" },
	});

describe("HTML-only response correction", () => {
	it("matches absent, wildcard and parameterized HTML accepts", () => {
		expect(acceptsHtml(new Request("https://example.test"))).toBe(true);
		expect(
			acceptsHtml(
				new Request("https://example.test", { headers: { Accept: "*/*" } }),
			),
		).toBe(true);
		expect(
			acceptsHtml(
				new Request("https://example.test", {
					headers: { Accept: "application/json, text/html;q=0.9" },
				}),
			),
		).toBe(true);
		expect(
			acceptsHtml(
				new Request("https://example.test", {
					headers: { Accept: "application/json" },
				}),
			),
		).toBe(false);
	});

	it("turns the exact framework refusal into a 404", async () => {
		const response = await replaceHtmlOnlyRefusal(
			new Request("https://example.test/not-an-api", {
				headers: { Accept: "application/json" },
			}),
			refusal(),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: "Not found. This path is served as HTML only.",
		});
	});

	it("passes a successful JSON metadata document through untouched", async () => {
		const request = new Request(
			"https://example.test/.well-known/oauth-protected-resource",
			{ headers: { Accept: "application/json" } },
		);
		const metadata = Response.json({
			resource: "https://example.test/mcp",
		});
		expect(await replaceHtmlOnlyRefusal(request, metadata)).toBe(metadata);
	});

	it("passes through successful, HTML and unrelated error responses", async () => {
		const request = new Request("https://example.test", {
			headers: { Accept: "application/json" },
		});
		const ok = new Response("ok", { status: 200 });
		expect(await replaceHtmlOnlyRefusal(request, ok)).toBe(ok);
		expect(
			await replaceHtmlOnlyRefusal(
				new Request(request, { headers: { Accept: "text/html" } }),
				refusal(),
			),
		).toSatisfy((response) => response.status === 500);
		expect(
			await replaceHtmlOnlyRefusal(
				request,
				new Response("other", { status: 500 }),
			),
		).toSatisfy((response) => response.status === 500);
		const consumed = refusal();
		await consumed.text();
		expect(await replaceHtmlOnlyRefusal(request, consumed)).toBe(consumed);
		const throwingResponse = {
			status: 500,
			clone() {
				throw "clone failed";
			},
		} as unknown as Response;
		expect(await replaceHtmlOnlyRefusal(request, throwingResponse)).toBe(
			throwingResponse,
		);
	});
});
