import { expect, type Page, test } from "@playwright/test";

async function visitReachablePage(page: Page, path: string) {
	const response = await page.goto(path, { waitUntil: "domcontentloaded" });

	if (response === null) {
		throw new Error(`Navigation to ${path} did not return an HTTP response.`);
	}

	expect(response.ok(), `${path} returned HTTP ${response.status()}.`).toBe(
		true,
	);
}

test("case 1: the home page is reachable", async ({ page }) => {
	await visitReachablePage(page, "/");

	expect(new URL(page.url()).pathname).toBe("/");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("case 2: the privacy policy is reachable", async ({ page }) => {
	await visitReachablePage(page, "/privacy");

	expect(new URL(page.url()).pathname).toBe("/privacy");
	await expect(
		page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
	).toBeVisible();
});

test("case 3: the terms of service are reachable", async ({ page }) => {
	await visitReachablePage(page, "/terms");

	expect(new URL(page.url()).pathname).toBe("/terms");
	await expect(
		page.getByRole("heading", { level: 1, name: "Terms of Service" }),
	).toBeVisible();
});

test("case 4: an anonymous dashboard visit requires sign-in", async ({
	page,
}) => {
	await visitReachablePage(page, "/dashboard");

	const finalUrl = new URL(page.url());
	expect(finalUrl.pathname).toBe("/login");
	expect(finalUrl.searchParams.get("redirect")).toBe("/dashboard");
	await expect(
		page.getByRole("heading", { level: 1, name: "Sign in" }),
	).toBeVisible();
	await expect(page.getByLabel("Email")).toBeVisible();
	await expect(page.getByLabel("Password")).toBeVisible();
});
