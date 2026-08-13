import { GOOGLE_HEALTH_DATA_TYPES } from "../src/lib/google-health-scopes";
import { LEGAL, LEGAL_LINKS, LEGAL_RETENTION } from "../src/lib/legal";
import { waitForReactControl } from "./fixtures/guards";
import { expect, test } from "./fixtures/test";

const LIMITED_USE_HEADING_PATTERN =
	/Google API Services User Data Policy and Limited Use/;
const LIMITED_USE_LINK_PATTERN = /Limited Use requirements/;
const GOOGLE_HEALTH_PATTERN = /Google Health/;
const MEDICAL_WARNING_HEADING_PATTERN = /^5\. Not medical advice$/;
const GOOGLE_POLICY_LINK_PATTERN =
	/Google API Services User Data Policy and Limited Use/;
const LIMITED_USE_HASH_PATTERN = /#google-limited-use$/;

test.describe("legal and compliance contracts", () => {
	test("LEGAL-03 Limited Use is boxed and links to Google's deep policy anchor", async ({
		page,
	}) => {
		await page.goto("/privacy#google-limited-use");
		const section = page.locator("#google-limited-use");
		await expect(
			section.getByRole("heading", {
				name: LIMITED_USE_HEADING_PATTERN,
			}),
		).toBeVisible();
		await expect(
			section.getByRole("link", { name: LIMITED_USE_LINK_PATTERN }),
		).toHaveAttribute("href", LEGAL_LINKS.googleLimitedUse);
	});

	test("LEGAL-04 the privacy table has one row for every health category", async ({
		page,
	}) => {
		await page.goto("/privacy");
		const table = page.getByRole("table");
		await expect(table.getByRole("row")).toHaveCount(
			GOOGLE_HEALTH_DATA_TYPES.length + 1,
		);
		for (const dataType of GOOGLE_HEALTH_DATA_TYPES) {
			// biome-ignore lint/performance/noAwaitInLoops: Catalog order and labels are asserted one row at a time.
			await expect(
				table.getByRole("cell", { name: dataType.label }).first(),
			).toBeVisible();
		}
	});

	test("LEGAL-05 home and privacy expose the same category count", async ({
		page,
	}) => {
		await page.goto("/");
		await expect(
			page.getByText(
				`${GOOGLE_HEALTH_DATA_TYPES.length} health data categories`,
			),
		).toBeVisible();
		await page.goto("/privacy");
		await expect(page.getByRole("table").getByRole("row")).toHaveCount(
			GOOGLE_HEALTH_DATA_TYPES.length + 1,
		);
	});

	test("LEGAL-10 non-HTML requests get an honest 404", async ({ request }) => {
		const checks = [
			{ path: "/privacy", accept: "application/json", status: 404 },
			{ path: "/privacy", accept: "text/plain", status: 404 },
			{ path: "/terms", accept: "application/xml", status: 404 },
			{ path: "/terms", accept: "text/html", status: 200 },
		];
		const responses = await Promise.all(
			checks.map((check) =>
				request.get(check.path, { headers: { Accept: check.accept } }),
			),
		);
		for (const [index, response] of responses.entries()) {
			expect(response.status(), JSON.stringify(checks[index])).toBe(
				checks[index]?.status,
			);
		}
	});

	test("LEGAL-11 both documents own a distinct title and description", async ({
		page,
	}) => {
		for (const [path, title] of [
			["/privacy", `Privacy Policy — ${LEGAL.appName}`],
			["/terms", `Terms of Service — ${LEGAL.appName}`],
		] as const) {
			// biome-ignore lint/performance/noAwaitInLoops: The browser head is checked after each document navigation.
			await page.goto(path);
			await expect(page).toHaveTitle(title);
			await expect(page.locator('meta[name="description"]')).toHaveAttribute(
				"content",
				GOOGLE_HEALTH_PATTERN,
			);
		}
	});

	test("LEGAL-13 shared retention deadlines do not drift across documents", async ({
		request,
	}) => {
		const [privacy, terms] = await Promise.all([
			request.get("/privacy"),
			request.get("/terms"),
		]);
		const privacyHtml = await privacy.text();
		const termsHtml = await terms.text();
		for (const days of [
			LEGAL_RETENTION.deletionRequestDays,
			LEGAL_RETENTION.backupPurgeDays,
			LEGAL_RETENTION.serverLogDays,
		]) {
			expect(privacyHtml).toContain(String(days));
			expect(termsHtml).toContain(String(days));
		}
	});

	test("LEGAL-14 the medical warning is an early named section", async ({
		page,
	}) => {
		await page.goto("/terms#not-medical-advice");
		const heading = page.getByRole("heading", {
			name: MEDICAL_WARNING_HEADING_PATTERN,
		});
		await expect(heading).toBeVisible();
		await expect(
			page.getByText(`${LEGAL.appName} is not a medical device`, {
				exact: false,
			}),
		).toBeVisible();
	});

	test("LEGAL-21 disclosure precedes the Google authorization action", async ({
		page,
		context,
		addSession,
		signUp,
	}) => {
		await addSession(context, await signUp());
		await page.goto("/dashboard");
		const disclosure = page.getByText(
			"Before you grant this, here is what happens to the data.",
		);
		const authorize = page.getByRole("button", {
			name: "Authorize Google Health",
		});
		await expect(disclosure).toBeVisible();
		await expect(authorize).toBeVisible();
		expect(
			await disclosure.evaluate(
				(element, button) =>
					Boolean(
						button instanceof Element &&
							element.compareDocumentPosition(button) ===
								Node.DOCUMENT_POSITION_FOLLOWING,
					),
				await authorize.elementHandle(),
			),
		).toBe(true);
	});

	test("LEGAL-22 unsigned consent is inert and signed anonymous consent preserves its query", async ({
		request,
	}) => {
		const unsigned = await request.get("/consent", {
			maxRedirects: 0,
			headers: { Accept: "text/html" },
		});
		expect(unsigned.status()).toBe(200);
		expect(await unsigned.text()).toContain("No authorization request");

		const signedQuery = "client_id=test&ba_param=one&ba_param=two&sig=deadbeef";
		const signed = await request.get(`/consent?${signedQuery}`, {
			maxRedirects: 0,
			headers: { Accept: "text/html" },
		});
		expect(signed.status()).toBe(307);
		expect(signed.headers().location).toBe(`/login?${signedQuery}`);
	});

	test("LEGAL-09 the branded 404 stays inside the shared shell", async ({
		page,
	}) => {
		await page.goto("/missing-legal-test");
		await expect(
			page.getByRole("heading", { name: "That page is not here" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: LEGAL.productName, exact: false }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Go to home page" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
	});

	test("LEGAL-16 direct and table-of-contents anchors land on the named section", async ({
		page,
	}) => {
		await page.goto("/privacy");
		const link = page
			.getByRole("link", {
				name: GOOGLE_POLICY_LINK_PATTERN,
			})
			.first();
		await waitForReactControl(link);
		await link.click();
		await expect(page).toHaveURL(LIMITED_USE_HASH_PATTERN);
		await expect(page.locator("#google-limited-use")).toBeInViewport();

		await page.goto("/terms#not-medical-advice");
		await expect(page.locator("#not-medical-advice")).toBeInViewport();
	});
});
