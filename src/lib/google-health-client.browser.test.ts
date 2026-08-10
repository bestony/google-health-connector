import { afterEach, describe, expect, it, vi } from "vitest";

const { linkSocial } = vi.hoisted(() => ({ linkSocial: vi.fn() }));
vi.mock("./auth-client", () => ({ authClient: { linkSocial } }));

import { requestGoogleHealthAccess } from "./google-health-client";

afterEach(() => {
	linkSocial.mockReset();
	vi.unstubAllGlobals();
});

describe("requestGoogleHealthAccess", () => {
	it("returns a user-facing error when better-auth rejects the request", async () => {
		linkSocial.mockResolvedValue({
			data: null,
			error: { status: 400, message: "account not linked" },
		});
		expect(
			await requestGoogleHealthAccess({
				callbackURL: "/dashboard",
				errorCallbackURL: "/dashboard",
			}),
		).toContain("already exists");
	});

	it("rejects a response without an authorization URL", async () => {
		linkSocial.mockResolvedValue({ data: {}, error: null });
		expect(
			await requestGoogleHealthAccess({
				callbackURL: "/dashboard",
				errorCallbackURL: "/dashboard",
			}),
		).toContain("could not be started");
	});

	it("adds consent parameters and navigates to Google's HTTPS URL", async () => {
		linkSocial.mockResolvedValue({
			data: { url: "https://accounts.google.com/o/oauth2/auth?scope=one" },
			error: null,
		});
		const location = { href: "" };
		vi.stubGlobal("window", { location });

		const result = await requestGoogleHealthAccess({
			scopes: ["scope-a"],
			callbackURL: "/dashboard",
			errorCallbackURL: "/dashboard?error=1",
			loginHint: "user@example.com",
		});
		expect(result).toBeNull();
		expect(location.href).toContain("prompt=consent");
		expect(location.href).toContain("login_hint=user%40example.com");
		expect(linkSocial).toHaveBeenCalledWith({
			provider: "google",
			scopes: ["scope-a"],
			callbackURL: "/dashboard",
			errorCallbackURL: "/dashboard?error=1",
			disableRedirect: true,
		});

		linkSocial.mockResolvedValue({
			data: { url: "https://accounts.google.com/o/oauth2/auth" },
			error: null,
		});
		await requestGoogleHealthAccess({
			callbackURL: "/dashboard",
			errorCallbackURL: "/dashboard",
		});
		expect(location.href).not.toContain("login_hint");
	});

	it("rejects an unsafe non-HTTPS redirect URL", async () => {
		linkSocial.mockResolvedValue({
			data: { url: "javascript:alert(1)" },
			error: null,
		});
		vi.stubGlobal("window", { location: { href: "unchanged" } });
		expect(
			await requestGoogleHealthAccess({
				callbackURL: "/dashboard",
				errorCallbackURL: "/dashboard",
			}),
		).toContain("could not be started");
	});

	it("handles an unexpected non-Error URL failure", async () => {
		linkSocial.mockResolvedValue({
			data: { url: "https://accounts.google.com/o/oauth2/auth" },
			error: null,
		});
		class ThrowingUrl {
			constructor() {
				throw "invalid url";
			}
		}
		vi.stubGlobal("URL", ThrowingUrl);
		vi.stubGlobal("window", { location: { href: "unchanged" } });
		expect(
			await requestGoogleHealthAccess({
				callbackURL: "/dashboard",
				errorCallbackURL: "/dashboard",
			}),
		).toContain("could not be started");
	});
});
