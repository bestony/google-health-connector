import { request as playwrightRequest } from "@playwright/test";
import { waitForReactControl } from "./fixtures/guards";
import { initializeRequest, mcpPost } from "./fixtures/mcp";
import { expect, sessionCookieHeader, test } from "./fixtures/test";

const API_KEY_PATTERN = /^ghc_[A-Za-z0-9_-]{64}$/;

test.describe("API key lifecycle and isolation", () => {
	test("KEY-05 issued key summary exposes only the prefix, date and usage state", async ({
		page,
		context,
		addSession,
		apiKey,
		signUp,
	}) => {
		const account = await signUp();
		const issued = await apiKey(account);
		await addSession(context, account);
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();

		await expect(page.getByText("Active", { exact: true })).toBeVisible();
		await expect(
			page.getByText(issued.key.slice(0, 6), { exact: false }),
		).toBeVisible();
		await expect(page.getByText("Never", { exact: true })).toBeVisible();
		await expect(page.locator("body")).not.toContainText(issued.key);
	});

	test("KEY-06 both credential headers authenticate the same key", async ({
		request,
		apiKey,
		signUp,
	}) => {
		const issued = await apiKey(await signUp());
		const [apiKeyHeader, authorizationHeader] = await Promise.all([
			request.post("/mcp", {
				headers: {
					Accept: "application/json, text/event-stream",
					"Content-Type": "application/json",
					"x-api-key": issued.key,
				},
				data: initializeRequest,
			}),
			request.post("/mcp", {
				headers: {
					Accept: "application/json, text/event-stream",
					Authorization: `Bearer ${issued.key}`,
					"Content-Type": "application/json",
				},
				data: initializeRequest,
			}),
		]);
		expect(apiKeyHeader.status()).toBe(200);
		expect(authorizationHeader.status()).toBe(200);
		expect(await apiKeyHeader.json()).toEqual(await authorizationHeader.json());
	});

	test("KEY-10 regenerate confirmation can be cancelled without a mutation", async ({
		page,
		context,
		addSession,
		apiKey,
		signUp,
	}) => {
		const account = await signUp();
		await apiKey(account);
		await addSession(context, account);
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();

		let serverFunctionPosts = 0;
		page.on("request", (request) => {
			if (
				request.method() === "POST" &&
				request.url().includes("/_serverFn/")
			) {
				serverFunctionPosts += 1;
			}
		});
		await page.getByRole("button", { name: "Regenerate" }).click();
		await expect(
			page.getByText("Regenerating revokes", { exact: false }),
		).toBeVisible();
		expect(serverFunctionPosts).toBe(0);
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page.getByText("Regenerating revokes", { exact: false }),
		).toHaveCount(0);
		expect(serverFunctionPosts).toBe(0);
	});
});

test.describe("API key mutation contracts", () => {
	test("KEY-11 regenerate replaces the credential and invalidates the old key", async ({
		page,
		context,
		request,
		addSession,
		apiKey,
		signUp,
	}) => {
		const account = await signUp();
		const oldKey = (await apiKey(account)).key;
		await addSession(context, account);
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();
		await page.getByRole("button", { name: "Regenerate" }).click();
		await page.getByRole("button", { name: "Regenerate" }).last().click();

		const plaintext = page.locator("code").filter({ hasText: "ghc_" });
		await expect(plaintext).toBeVisible();
		const newKey = await plaintext.textContent();
		expect(newKey).toMatch(API_KEY_PATTERN);
		expect(newKey).not.toBe(oldKey);
		expect(
			(await mcpPost(request, initializeRequest, { apiKey: oldKey })).status(),
		).toBe(401);
		expect(
			(
				await mcpPost(request, initializeRequest, { apiKey: newKey ?? "" })
			).status(),
		).toBe(200);
	});

	test("KEY-13 revoke removes the key and invalidates it immediately", async ({
		page,
		context,
		request,
		addSession,
		apiKey,
		signUp,
	}) => {
		const account = await signUp();
		const key = (await apiKey(account)).key;
		await addSession(context, account);
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();
		await page.getByRole("button", { name: "Revoke" }).click();
		await page.getByRole("button", { name: "Revoke" }).last().click();

		await expect(page.getByText("No key yet", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Generate API key" }),
		).toBeVisible();
		expect(
			(await mcpPost(request, initializeRequest, { apiKey: key })).status(),
		).toBe(401);
	});

	test("KEY-14 one-time plaintext survives tab switches but not reload", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		await addSession(context, await signUp());
		await page.goto("/dashboard");
		const apiKeyTab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(apiKeyTab);
		await apiKeyTab.click();
		await page.getByRole("button", { name: "Generate API key" }).click();
		const plaintext = page.locator("code").filter({ hasText: "ghc_" });
		const key = await plaintext.textContent();

		await page.getByRole("tab", { name: "Google Health" }).click();
		await apiKeyTab.click();
		await expect(plaintext).toHaveText(key ?? "");
		await page.reload();
		await expect(page.locator("body")).not.toContainText(key ?? "missing-key");
	});
});

test.describe("API key presentation and boundary contracts", () => {
	test("KEY-16 copy writes the exact plaintext to the clipboard", async ({
		page,
		context,
		profile,
		addSession,
		signUp,
	}) => {
		await context.grantPermissions(["clipboard-read", "clipboard-write"], {
			origin: profile.baseURL,
		});
		await addSession(context, await signUp());
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();
		await page.getByRole("button", { name: "Generate API key" }).click();
		const key = await page
			.locator("code")
			.filter({ hasText: "ghc_" })
			.textContent();
		await page.getByRole("button", { name: "Copy" }).click();
		await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);
	});

	test("KEY-18 connect snippet is collapsed and uses this deployment URL", async ({
		page,
		context,
		profile,
		addSession,
		signUp,
	}) => {
		await addSession(context, await signUp());
		await page.goto("/dashboard");
		const tab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(tab);
		await tab.click();
		const details = page.getByText("Connect an MCP client").locator("..");
		await expect(details).not.toHaveAttribute("open", "");
		await page.getByText("Connect an MCP client").click();
		await expect(details).toContainText(`${profile.baseURL}/mcp`);
		await expect(details).toContainText("YOUR_KEY");
		await expect(details).not.toContainText("OAuth");
	});

	test("KEY-22 a browser session cookie is not an MCP credential", async ({
		request,
		signUp,
	}) => {
		const account = await signUp();
		const response = await request.post("/mcp", {
			headers: {
				Accept: "application/json, text/event-stream",
				Cookie: sessionCookieHeader(account),
				"Content-Type": "application/json",
			},
			data: initializeRequest,
		});
		expect(response.status()).toBe(401);
		expect(response.headers()["www-authenticate"]).toContain("Bearer");
	});

	test("KEY-25 an API key cannot act as a browser session", async ({
		profile,
		apiKey,
		signUp,
	}) => {
		const issued = await apiKey(await signUp());
		const isolated = await playwrightRequest.newContext({
			baseURL: profile.baseURL,
		});
		try {
			const session = await isolated.get("/api/auth/get-session", {
				headers: { "x-api-key": issued.key },
			});
			expect(session.status()).toBe(200);
			expect(await session.text()).toBe("null");

			const create = await isolated.post("/api/auth/api-key/create", {
				headers: {
					Origin: profile.baseURL,
					"x-api-key": issued.key,
				},
				data: { name: "successor" },
			});
			expect(create.status()).toBe(401);
		} finally {
			await isolated.dispose();
		}
	});
});

test("@oauth KEY-20 OAuth profile advertises a credential-less connection command", async ({
	page,
	context,
	profile,
	addSession,
	signUp,
}) => {
	await addSession(context, await signUp());
	await page.goto("/dashboard");
	const tab = page.getByRole("tab", { name: "API key" });
	await waitForReactControl(tab);
	await tab.click();
	await page.getByText("Connect an MCP client").click();
	const details = page.getByText("Connect an MCP client").locator("..");
	await expect(details).toContainText("OAuth");
	await expect(details).toContainText(
		`claude mcp add --transport http ghealth ${profile.baseURL}/mcp`,
	);
});
