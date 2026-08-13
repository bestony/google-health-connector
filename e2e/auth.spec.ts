import { randomUUID } from "node:crypto";
import { waitForReactControl } from "./fixtures/guards";
import { expect, sessionCookieHeader, test } from "./fixtures/test";

const DASHBOARD_URL = /\/dashboard$/;
const LOGIN_URL = /\/login$/;

test.describe("authentication and session boundaries", () => {
	test("@smoke AUTH-04 anonymous dashboard preserves the deep link", async ({
		request,
	}) => {
		const response = await request.get("/dashboard", {
			maxRedirects: 0,
			headers: { Accept: "text/html" },
		});

		expect(response.status()).toBe(307);
		expect(response.headers().location).toBe("/login?redirect=%2Fdashboard");
	});

	test("AUTH-02 email sign-up issues a session and reaches the dashboard", async ({
		page,
		context,
	}) => {
		await context.setExtraHTTPHeaders({
			"x-forwarded-for": `10.88.0.${Math.floor(Math.random() * 200) + 1}`,
		});
		await page.goto("/login");
		const toggle = page.getByRole("button", {
			name: "Need an account? Sign up",
		});
		await waitForReactControl(toggle);
		await toggle.click();

		const email = `ui-${randomUUID()}@example.test`;
		await page.getByLabel("Name").fill("UI E2E User");
		await page.getByLabel("Email").fill(email);
		await page.getByLabel("Password").fill("password12345");
		await page.getByRole("button", { name: "Sign up" }).click();

		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(
			page.getByRole("heading", { name: "Dashboard" }),
		).toBeVisible();
		await expect(page.locator("dd").filter({ hasText: email })).toBeVisible();
	});

	test("AUTH-03 email sign-in resumes a dashboard continuation", async ({
		page,
		context,
		signUp,
	}) => {
		const account = await signUp();
		await context.setExtraHTTPHeaders({
			"x-forwarded-for": `10.89.0.${Math.floor(Math.random() * 200) + 1}`,
		});
		await page.goto("/login?redirect=%2Fdashboard");
		await waitForReactControl(page.getByRole("button", { name: "Sign in" }));
		await page.getByLabel("Email").fill(account.email);
		await page.getByLabel("Password").fill(account.password);
		await page.getByRole("button", { name: "Sign in" }).click();

		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(page.getByText(account.email)).toBeVisible();
	});

	test("AUTH-05 a forged session cookie stays anonymous", async ({
		request,
		profile,
	}) => {
		const response = await request.get("/dashboard", {
			maxRedirects: 0,
			headers: {
				Cookie: "better-auth.session_token=forged.invalid.value",
				Accept: "text/html",
			},
		});

		expect(response.status()).toBe(307);
		expect(response.headers().location).toBe("/login?redirect=%2Fdashboard");
		expect(new URL(profile.baseURL).hostname).toBe("127.0.0.1");
	});

	test("AUTH-06 a signed-in visitor leaves login for the dashboard", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		await page.goto("/login");

		await expect(page).toHaveURL(DASHBOARD_URL);
		await expect(
			page.getByRole("heading", { name: "Dashboard" }),
		).toBeVisible();
	});

	test("AUTH-08 a cookie-bearing cross-origin auth request is rejected", async ({
		request,
		signUp,
	}) => {
		const account = await signUp();
		const response = await request.post("/api/auth/sign-out", {
			headers: {
				Origin: "https://evil.example",
				Cookie: sessionCookieHeader(account),
				"Content-Type": "application/json",
			},
			data: {},
		});

		expect(response.status()).toBe(403);
		await expect(response.json()).resolves.toMatchObject({
			code: "INVALID_ORIGIN",
		});
	});

	test("AUTH-11 sign-out clears the session and returns to login", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		const account = await signUp();
		await addSession(context, account);
		await page.goto("/dashboard");

		const signOut = page.getByRole("button", { name: "Sign out" });
		await waitForReactControl(signOut);
		await signOut.click();
		await expect(page).toHaveURL(LOGIN_URL);
		await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
		await expect(page.context().cookies()).resolves.toHaveLength(0);
	});

	test("AUTH-14 the eight-character password boundary is enforced by the form", async ({
		page,
		context,
	}) => {
		await context.setExtraHTTPHeaders({
			"x-forwarded-for": `10.90.0.${Math.floor(Math.random() * 200) + 1}`,
		});
		await page.goto("/login");
		const toggle = page.getByRole("button", {
			name: "Need an account? Sign up",
		});
		await waitForReactControl(toggle);
		await toggle.click();
		const password = page.getByLabel("Password");
		await password.fill("short");
		await expect(password).toHaveJSProperty("validity.tooShort", true);
		await expect(password).toHaveJSProperty("validity.valid", false);
	});
});
