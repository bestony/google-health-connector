import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { waitForReactControl } from "./fixtures/guards";
import { expect, test } from "./fixtures/test";

interface RegisteredClient {
	client_id: string;
}

const CONSENT_URL_PATTERN = /\/consent\?/;
const TERMS_CODE_URL_PATTERN = /\/terms\?.*code=/;
const TERMS_DENIED_URL_PATTERN = /\/terms\?.*error=access_denied/;
const CODE_QUERY_PATTERN = /code=/;

function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

async function registerClient(
	request: APIRequestContext,
	baseURL: string,
	ip: string,
): Promise<RegisteredClient> {
	const response = await request.post("/api/auth/oauth2/register", {
		headers: { Origin: baseURL, "x-forwarded-for": ip },
		data: {
			client_name: "E2E OAuth client",
			redirect_uris: [`${baseURL}/terms`],
			token_endpoint_auth_method: "none",
			application_type: "native",
		},
	});
	if (!response.ok()) {
		throw new Error(
			`OAuth client registration failed with HTTP ${response.status()}: ${await response.text()}`,
		);
	}
	return (await response.json()) as RegisteredClient;
}

function authorizationUrl(
	baseURL: string,
	clientId: string,
	challenge: string,
	scope = "openid offline_access mcp:health:read",
): string {
	const query = new URLSearchParams({
		client_id: clientId,
		redirect_uri: `${baseURL}/terms`,
		response_type: "code",
		scope,
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: `${baseURL}/mcp`,
	});
	return `/api/auth/oauth2/authorize?${query.toString()}`;
}

test.describe("@oauth OAuth authorization flow", () => {
	test("OAUTH-05 authorization, consent and token produce a working MCP JWT", async ({
		page,
		context,
		request,
		profile,
		addSession,
		signUp,
	}) => {
		const client = await registerClient(request, profile.baseURL, "10.71.1.1");
		const proof = pkce();
		await addSession(context, await signUp());
		await page.goto(
			authorizationUrl(profile.baseURL, client.client_id, proof.challenge),
		);
		await expect(page).toHaveURL(CONSENT_URL_PATTERN);
		await expect(
			page.getByRole("heading", { name: "Authorize E2E OAuth client?" }),
		).toBeVisible();
		const approve = page.getByRole("button", { name: "Approve" });
		await waitForReactControl(approve);
		await approve.click();
		await expect(page).toHaveURL(TERMS_CODE_URL_PATTERN);
		const code = new URL(page.url()).searchParams.get("code");
		expect(code).toBeTruthy();

		const token = await request.post("/api/auth/oauth2/token", {
			headers: {
				Origin: profile.baseURL,
				"x-forwarded-for": "10.71.1.2",
			},
			form: {
				grant_type: "authorization_code",
				client_id: client.client_id,
				redirect_uri: `${profile.baseURL}/terms`,
				code: code ?? "",
				code_verifier: proof.verifier,
				resource: `${profile.baseURL}/mcp`,
			},
		});
		expect(token.status()).toBe(200);
		const tokenBody = (await token.json()) as {
			access_token?: string;
			refresh_token?: string;
			token_type?: string;
			scope?: string;
		};
		expect(tokenBody.access_token?.split(".")).toHaveLength(3);
		expect(tokenBody.refresh_token).toEqual(expect.any(String));
		expect(tokenBody.token_type?.toLowerCase()).toBe("bearer");
		expect(tokenBody.scope).toContain("mcp:health:read");

		const mcp = await request.post("/mcp", {
			headers: {
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${tokenBody.access_token}`,
				"Content-Type": "application/json",
			},
			data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
		});
		expect(mcp.status()).toBe(200);
		await expect(mcp.json()).resolves.toMatchObject({
			result: { tools: expect.any(Array) },
		});
	});

	test("OAUTH-12 denying consent returns access_denied and creates no code", async ({
		page,
		context,
		request,
		profile,
		addSession,
		signUp,
	}) => {
		const client = await registerClient(request, profile.baseURL, "10.71.2.1");
		const proof = pkce();
		await addSession(context, await signUp());
		await page.goto(
			authorizationUrl(profile.baseURL, client.client_id, proof.challenge),
		);
		const deny = page.getByRole("button", { name: "Deny" });
		await waitForReactControl(deny);
		await deny.click();
		await expect(page).toHaveURL(TERMS_DENIED_URL_PATTERN);
		const result = new URL(page.url()).searchParams;
		expect(result.get("error")).toBe("access_denied");
		expect(result.get("code")).toBeNull();
	});

	test("OAUTH-14 token endpoint enforces the PKCE verifier and single-use code", async ({
		page,
		context,
		request,
		profile,
		addSession,
		signUp,
	}) => {
		const client = await registerClient(request, profile.baseURL, "10.71.3.1");
		const proof = pkce();
		await addSession(context, await signUp());
		await page.goto(
			authorizationUrl(profile.baseURL, client.client_id, proof.challenge),
		);
		const approve = page.getByRole("button", { name: "Approve" });
		await waitForReactControl(approve);
		await approve.click();
		await expect(page).toHaveURL(CODE_QUERY_PATTERN);
		const code = new URL(page.url()).searchParams.get("code") ?? "";
		const form = {
			grant_type: "authorization_code",
			client_id: client.client_id,
			redirect_uri: `${profile.baseURL}/terms`,
			code,
			resource: `${profile.baseURL}/mcp`,
		};
		const invalid = await request.post("/api/auth/oauth2/token", {
			headers: { Origin: profile.baseURL, "x-forwarded-for": "10.71.3.2" },
			form: { ...form, code_verifier: "wrong-verifier" },
		});
		expect(invalid.status()).toBe(401);

		const secondProof = pkce();
		await page.goto(
			authorizationUrl(
				profile.baseURL,
				client.client_id,
				secondProof.challenge,
			),
		);
		await expect(page).toHaveURL(CODE_QUERY_PATTERN);
		const secondCode = new URL(page.url()).searchParams.get("code") ?? "";
		const secondForm = { ...form, code: secondCode };

		const accepted = await request.post("/api/auth/oauth2/token", {
			headers: { Origin: profile.baseURL, "x-forwarded-for": "10.71.3.3" },
			form: { ...secondForm, code_verifier: secondProof.verifier },
		});
		expect(accepted.status()).toBe(200);

		const replay = await request.post("/api/auth/oauth2/token", {
			headers: { Origin: profile.baseURL, "x-forwarded-for": "10.71.3.4" },
			form: { ...secondForm, code_verifier: secondProof.verifier },
		});
		expect([400, 401]).toContain(replay.status());
	});
});
