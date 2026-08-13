import { randomUUID } from "node:crypto";
import { GOOGLE_HEALTH_SCOPES } from "../src/lib/google-health-scopes";
import { waitForReactControl } from "./fixtures/guards";
import { expect, test } from "./fixtures/test";

const API_KEY_PATTERN = /^ghc_[A-Za-z0-9_-]{64}$/;

test.describe("dashboard seams", () => {
	test("HEALTH-02 an unlinked user sees the Google Health authorization state", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		const response = await page.goto("/dashboard");
		expect(response?.status()).toBe(200);

		await expect(
			page.getByRole("heading", { name: "Google Health" }),
		).toBeVisible();
		await expect(
			page.getByText("Not connected", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText(
				`0 of ${GOOGLE_HEALTH_SCOPES.length} permissions granted`,
				{
					exact: true,
				},
			),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Authorize Google Health" }),
		).toBeVisible();
	});

	test("HEALTH-05 a seeded Google grant renders its granted scope count in SSR", async ({
		request,
		db,
		signUp,
	}) => {
		const account = await signUp();
		const now = Date.now();
		await db.execute({
			sql: `INSERT INTO account (id, account_id, provider_id, user_id, scope, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [
				randomUUID(),
				`google-${randomUUID()}`,
				"google",
				account.id,
				GOOGLE_HEALTH_SCOPES.slice(0, 3).join(","),
				now,
				now,
			],
		});

		const response = await request.get("/dashboard", {
			maxRedirects: 0,
			headers: {
				Accept: "text/html",
				Cookie: `${account.cookieName}=${account.sessionCookie}`,
			},
		});
		expect(response.status()).toBe(200);
		const html = (await response.body())
			.toString("utf8")
			.replaceAll("<!-- -->", "");
		expect(html).toContain("Some permissions granted");
		expect(html).toContain(
			`3 of ${GOOGLE_HEALTH_SCOPES.length} permissions granted`,
		);
	});

	test("KEY-02 an account without a key has one generate action", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		await page.goto("/dashboard");
		const apiKeyTab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(apiKeyTab);
		await apiKeyTab.click();

		await expect(page.getByText("No key yet", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Generate API key" }),
		).toHaveCount(1);
		await expect(page.getByText("Copy this now", { exact: false })).toHaveCount(
			0,
		);
	});

	test("KEY-04 generating a key shows plaintext once and a safe summary", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		await page.goto("/dashboard");
		const apiKeyTab = page.getByRole("tab", { name: "API key" });
		await waitForReactControl(apiKeyTab);
		await apiKeyTab.click();
		const generate = page.getByRole("button", { name: "Generate API key" });
		await waitForReactControl(generate);
		await generate.click();

		const key = page.locator("code").filter({ hasText: "ghc_" });
		await expect(key).toBeVisible();
		const plaintext = await key.textContent();
		expect(plaintext).toMatch(API_KEY_PATTERN);
		await expect(page.getByText("Active", { exact: true })).toBeVisible();
		await expect(page.getByText("Last used", { exact: true })).toBeVisible();
		await expect(page.getByText("Never", { exact: true })).toBeVisible();
	});

	test("@no-google HEALTH-20 reports that Google sign-in is disabled", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		await page.goto("/dashboard");

		await expect(
			page.getByText("Google sign-in off", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("GOOGLE_CLIENT_ID", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Authorize Google Health" }),
		).toHaveCount(0);
	});
});
