import { LEGAL } from "../src/lib/legal";
import { waitForReactControl } from "./fixtures/guards";
import { expect, test } from "./fixtures/test";

const AUTH_ACTION_PATTERN = /Sign in|Dashboard/;
const PRIVACY_URL_PATTERN = /\/privacy$/;

test.describe("application shell contracts", () => {
	test("SHELL-04 header wordmark is present on every page and returns home", async ({
		page,
	}) => {
		for (const path of [
			"/",
			"/login",
			"/privacy",
			"/terms",
			"/missing-shell",
		]) {
			// biome-ignore lint/performance/noAwaitInLoops: Shell persistence is checked after each navigation.
			await page.goto(path);
			const wordmark = page.locator("header").getByRole("link", {
				name: new RegExp(LEGAL.productName),
			});
			await expect(wordmark).toHaveAttribute("href", "/");
		}
	});

	test("SHELL-05 header exposes only the session-appropriate action", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		await page.goto("/");
		await expect(
			page.locator("header").getByRole("link", { name: "Sign in" }),
		).toBeVisible();
		await expect(
			page.locator("header").getByRole("link", { name: "Dashboard" }),
		).toHaveCount(0);

		await addSession(context, await signUp());
		await page.goto("/");
		await expect(
			page.locator("header").getByRole("link", { name: "Dashboard" }),
		).toBeVisible();

		await page.goto("/login?sig=keep-on-login");
		await expect(
			page.locator("header").getByRole("link", { name: AUTH_ACTION_PATTERN }),
		).toHaveCount(0);
	});

	test("SHELL-06 footer remains on normal and error pages", async ({
		page,
	}) => {
		for (const path of ["/", "/privacy", "/missing-footer"]) {
			// biome-ignore lint/performance/noAwaitInLoops: Footer persistence is checked after each navigation.
			await page.goto(path);
			const footer = page.locator("footer");
			await expect(footer).toContainText(`© ${LEGAL.copyrightYear}`);
			await expect(
				footer.getByRole("link", { name: "Privacy Policy" }),
			).toBeVisible();
		}
	});

	test("SHELL-09 page routes correct the framework's non-HTML refusal", async ({
		request,
	}) => {
		const rows = [
			{ accept: "application/json", expected: 404 },
			{ accept: "text/plain", expected: 404 },
			{ accept: "application/xml", expected: 404 },
			{ accept: "text/html", expected: 200 },
			{ accept: "*/*", expected: 200 },
			{ accept: "application/json, text/html", expected: 200 },
		];
		const responses = await Promise.all(
			rows.map((row) =>
				request.get("/privacy", { headers: { Accept: row.accept } }),
			),
		);
		for (const [index, response] of responses.entries()) {
			expect(response.status(), rows[index]?.accept).toBe(
				rows[index]?.expected,
			);
		}
	});

	test("SHELL-14 shell links navigate client-side without a document reload", async ({
		page,
	}) => {
		await page.goto("/");
		const originalNavigationEntries = await page.evaluate(
			() => performance.getEntriesByType("navigation").length,
		);
		const privacy = page.locator("footer").getByRole("link", {
			name: "Privacy Policy",
		});
		await waitForReactControl(privacy);
		await privacy.click();
		await expect(page).toHaveURL(PRIVACY_URL_PATTERN);
		expect(
			await page.evaluate(
				() => performance.getEntriesByType("navigation").length,
			),
		).toBe(originalNavigationEntries);
	});

	test("SHELL-18 logo asset and document references agree", async ({
		page,
		request,
	}) => {
		const asset = await request.get("/logo.svg");
		expect(asset.status()).toBe(200);
		expect(asset.headers()["content-type"]).toContain("image/svg+xml");

		await page.goto("/");
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			"href",
			"/logo.svg",
		);
		await expect(page.locator("header img")).toHaveAttribute(
			"src",
			"/logo.svg",
		);
	});

	test("SHELL-19 mounted route inventory keeps pages and APIs distinct", async ({
		request,
	}) => {
		const cases = [
			{ path: "/", accept: "text/html", status: 200, type: "text/html" },
			{ path: "/login", accept: "text/html", status: 200, type: "text/html" },
			{ path: "/privacy", accept: "text/html", status: 200, type: "text/html" },
			{ path: "/terms", accept: "text/html", status: 200, type: "text/html" },
			{
				path: "/mcp",
				accept: "application/json",
				status: 405,
				type: "application/json",
			},
		];
		const responses = await Promise.all(
			cases.map((entry) =>
				request.get(entry.path, {
					maxRedirects: 0,
					headers: { Accept: entry.accept },
				}),
			),
		);
		for (const [index, response] of responses.entries()) {
			const expected = cases[index];
			expect(response.status(), expected?.path).toBe(expected?.status);
			expect(response.headers()["content-type"], expected?.path).toContain(
				expected?.type,
			);
		}
	});

	test("SHELL-23 every public page completes with the hydration entry", async ({
		request,
	}) => {
		const responses = await Promise.all(
			["/", "/login", "/privacy", "/terms", "/consent"].map((path) =>
				request.get(path, { headers: { Accept: "text/html" } }),
			),
		);
		const htmlDocuments = await Promise.all(
			responses.map((response) => response.text()),
		);
		for (const html of htmlDocuments) {
			expect(html).toContain("virtual:tanstack-start-dev-client-entry");
			expect(html).toContain("</html>");
		}
	});
});
