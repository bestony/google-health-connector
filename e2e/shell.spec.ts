import { expect, test } from "./fixtures/test";

test.describe("SSR shell and public routes", () => {
	test("SHELL-01 the home page ships its primary content in SSR HTML", async ({
		request,
	}) => {
		const response = await request.get("/", {
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain("Connect Google Health once");
		expect(html).toContain("12 health data categories");
		expect(html).toContain("Free to connect. Pay only for the past.");
	});

	test("SHELL-07 an unknown path returns the branded not-found page", async ({
		request,
	}) => {
		const response = await request.get("/does-not-exist", {
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(404);
		const html = await response.text();
		expect(html).toContain("That page is not here");
		expect(html).toContain(">404<");
	});

	test("SHELL-13 the home page hydrates without a browser error", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});

		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test("LEGAL-01 privacy is public and contains the disclosed-data table", async ({
		page,
		request,
	}) => {
		const response = await request.get("/privacy", {
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain("Privacy Policy");
		expect(html).toContain("Limited Use");
		expect(html).toContain("What it contains");

		await page.goto("/privacy");
		await expect(
			page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
		).toBeVisible();
		await expect(page.getByRole("table")).toBeVisible();
	});

	test("LEGAL-02 terms exposes the medical-advice warning", async ({
		page,
		request,
	}) => {
		const response = await request.get("/terms", {
			headers: { Accept: "text/html" },
		});
		expect(response.status()).toBe(200);
		const html = await response.text();
		expect(html).toContain("Terms of Service");
		expect(html).toContain("not a medical device");

		await page.goto("/terms");
		await expect(
			page.getByRole("heading", { level: 1, name: "Terms of Service" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Not medical advice" }),
		).toBeVisible();
	});

	test("LEGAL-08 every public document links to both legal pages", async ({
		page,
	}) => {
		for (const path of ["/", "/privacy", "/terms"]) {
			// biome-ignore lint/performance/noAwaitInLoops: Each navigation is intentionally sequential in one browser context.
			await page.goto(path);
			await expect(
				page.getByRole("link", { name: "Privacy Policy", exact: true }).last(),
			).toBeVisible();
			await expect(
				page
					.getByRole("link", { name: "Terms of Service", exact: true })
					.last(),
			).toBeVisible();
		}
	});
});
