import { randomUUID } from "node:crypto";
import { request as playwrightRequest } from "@playwright/test";
import { waitForReactControl } from "./fixtures/guards";
import { expect, sessionCookieHeader, test } from "./fixtures/test";

function authHeaders(origin: string, ip: string) {
	return { Origin: origin, "x-forwarded-for": ip };
}

test.describe("authentication wire contracts", () => {
	test("AUTH-01 the test origin is trusted and owns a disposable database", async ({
		request,
		profile,
	}) => {
		const response = await request.post("/api/auth/sign-in/email", {
			headers: authHeaders(profile.baseURL, "10.40.1.1"),
			data: { email: "missing@example.test", password: "password12345" },
		});
		expect(response.status()).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			code: "INVALID_EMAIL_OR_PASSWORD",
		});

		expect(profile.databaseUrl).toContain(`${profile.name}.db`);
		expect(profile.databaseUrl).not.toContain("/src/");
		expect(profile.env.BETTER_AUTH_URL).toBe(profile.baseURL);
	});

	test("AUTH-10 wrong password and unknown email have the same response", async ({
		request,
		profile,
		signUp,
	}) => {
		const account = await signUp();
		const [wrongPassword, unknownEmail] = await Promise.all([
			request.post("/api/auth/sign-in/email", {
				headers: authHeaders(profile.baseURL, "10.40.2.1"),
				data: { email: account.email, password: "definitely-wrong-1" },
			}),
			request.post("/api/auth/sign-in/email", {
				headers: authHeaders(profile.baseURL, "10.40.2.2"),
				data: {
					email: `unknown-${randomUUID()}@example.test`,
					password: "definitely-wrong-1",
				},
			}),
		]);
		expect(wrongPassword.status()).toBe(401);
		expect(unknownEmail.status()).toBe(401);
		expect(await wrongPassword.text()).toBe(await unknownEmail.text());
	});

	test("AUTH-13 duplicate sign-up returns the stable 422 contract", async ({
		request,
		profile,
		signUp,
	}) => {
		const account = await signUp();
		const response = await request.post("/api/auth/sign-up/email", {
			headers: authHeaders(profile.baseURL, "10.40.3.1"),
			data: {
				name: account.name,
				email: account.email,
				password: account.password,
			},
		});
		expect(response.status()).toBe(422);
		await expect(response.json()).resolves.toEqual({
			message: "User already exists. Use another email.",
			code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
		});
	});

	test("AUTH-14 the server rejects seven characters and accepts eight", async ({
		request,
		profile,
	}) => {
		const rejected = await request.post("/api/auth/sign-up/email", {
			headers: authHeaders(profile.baseURL, "10.40.4.1"),
			data: {
				name: "Seven",
				email: `seven-${randomUUID()}@example.test`,
				password: "1234567",
			},
		});
		expect(rejected.status()).toBe(400);
		await expect(rejected.json()).resolves.toMatchObject({
			code: "PASSWORD_TOO_SHORT",
		});

		const accepted = await request.post("/api/auth/sign-up/email", {
			headers: authHeaders(profile.baseURL, "10.40.4.2"),
			data: {
				name: "Eight",
				email: `eight-${randomUUID()}@example.test`,
				password: "12345678",
			},
		});
		expect(accepted.status()).toBe(200);
	});

	test("AUTH-15 a signed OAuth continuation suppresses the signed-in bounce", async ({
		request,
		signUp,
	}) => {
		const account = await signUp();
		const kept = await request.get(
			"/login?ba_param=one&ba_param=two&sig=deadbeef",
			{
				maxRedirects: 0,
				headers: {
					Accept: "text/html",
					Cookie: sessionCookieHeader(account),
				},
			},
		);
		expect(kept.status()).toBe(200);
		expect(kept.headers().location).toBeUndefined();
		expect(await kept.text()).toContain("Sign in");

		const empty = await request.get("/login?sig=", {
			maxRedirects: 0,
			headers: {
				Accept: "text/html",
				Cookie: sessionCookieHeader(account),
			},
		});
		expect(empty.status()).toBe(307);
		expect(empty.headers().location).toBe("/dashboard");
	});

	test("AUTH-16 the home CTA is decided in SSR from the session", async ({
		request,
		profile,
		signUp,
	}) => {
		const account = await signUp();
		const anonymousRequest = await playwrightRequest.newContext({
			baseURL: profile.baseURL,
		});
		const [anonymous, authenticated] = await Promise.all([
			anonymousRequest.get("/", { headers: { Accept: "text/html" } }),
			request.get("/", {
				headers: {
					Accept: "text/html",
					Cookie: sessionCookieHeader(account),
				},
			}),
		]);
		const anonymousHtml = await anonymous.text();
		const authenticatedHtml = await authenticated.text();
		await anonymousRequest.dispose();
		expect(anonymousHtml).toContain(">Sign in</a>");
		expect(anonymousHtml).toContain("Connect Google Health</a>");
		expect(authenticatedHtml).toContain(">Dashboard</a>");
		expect(authenticatedHtml).toContain("Open dashboard</a>");
	});

	test("AUTH-17 configured Google sign-in is present in the first HTML response", async ({
		request,
	}) => {
		const response = await request.get("/login", {
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain("Continue with Google");
		expect(html).toContain('fill="#EA4335"');
	});

	test("AUTH-23 mode changes clear a duplicate-account error", async ({
		page,
		context,
		signUp,
	}) => {
		const account = await signUp();
		await context.setExtraHTTPHeaders({ "x-forwarded-for": "10.40.5.1" });
		await page.goto("/login");
		const toSignUp = page.getByRole("button", {
			name: "Need an account? Sign up",
		});
		await waitForReactControl(toSignUp);
		await toSignUp.click();
		await page.getByLabel("Name").fill(account.name);
		await page.getByLabel("Email").fill(account.email);
		await page.getByLabel("Password").fill(account.password);
		await page.getByRole("button", { name: "Sign up" }).click();
		await expect(
			page.getByText("User already exists. Use another email."),
		).toBeVisible();

		await page
			.getByRole("button", { name: "Already registered? Sign in" })
			.click();
		await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
		await expect(
			page.getByText("User already exists. Use another email."),
		).toHaveCount(0);
	});

	test("AUTH-25 login links both legal documents before authentication", async ({
		page,
	}) => {
		await page.goto("/login");
		const notice = page.getByText("By continuing you agree", { exact: false });
		await expect(notice).toBeVisible();
		await expect(
			notice.getByRole("link", { name: "Terms of Service" }),
		).toHaveAttribute("href", "/terms");
		await expect(
			notice.getByRole("link", { name: "Privacy Policy" }),
		).toHaveAttribute("href", "/privacy");
	});
});

test("@no-google AUTH-18 absent Google credentials hide all Google sign-in UI", async ({
	page,
	request,
}) => {
	const response = await request.get("/login", {
		headers: { Accept: "text/html" },
	});
	expect(await response.text()).not.toContain("Continue with Google");
	await page.goto("/login");
	await expect(
		page.getByRole("button", { name: "Continue with Google" }),
	).toHaveCount(0);
});
