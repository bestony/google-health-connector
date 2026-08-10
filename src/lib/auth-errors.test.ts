import { describe, expect, it } from "vitest";
import {
	describeOAuthError,
	describeSignInError,
	sanitizeOAuthErrorParam,
} from "./auth-errors";

describe("OAuth error copy", () => {
	it("sanitizes only short non-empty strings", () => {
		expect(sanitizeOAuthErrorParam(" access_denied ")).toBe("access_denied");
		expect(sanitizeOAuthErrorParam(" ")).toBeUndefined();
		expect(sanitizeOAuthErrorParam("x".repeat(201))).toBeUndefined();
		expect(sanitizeOAuthErrorParam(42)).toBeUndefined();
		expect(sanitizeOAuthErrorParam(null)).toBeUndefined();
	});

	it("uses specific copy for known OAuth codes", () => {
		expect(describeOAuthError("access_denied")).toBe(
			"Google sign-in was cancelled.",
		);
		expect(describeOAuthError("redirect_uri_mismatch")).toContain(
			"redirect URI",
		);
	});

	it("retains an unknown code and optional description", () => {
		expect(describeOAuthError("new_code")).toBe(
			"Google sign-in failed (new_code).",
		);
		expect(describeOAuthError("new_code", "provider detail")).toBe(
			"Google sign-in failed: provider detail (new_code)",
		);
	});

	it("normalizes One Tap prose to the OAuth catalog", () => {
		expect(describeSignInError()).toBe("Google sign-in failed. Try again.");
		expect(describeSignInError("  account not linked ")).toContain(
			"already exists",
		);
		expect(describeSignInError("redirect-uri-mismatch")).toContain(
			"redirect URI",
		);
		expect(describeSignInError("Provider said something new")).toBe(
			"Google sign-in failed: Provider said something new",
		);
	});
});
