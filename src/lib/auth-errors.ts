/**
 * Copy for the OAuth failures better-auth reports through the URL.
 *
 * A failed social sign-in never returns to the caller's promise: better-auth
 * redirects the browser to `errorCallbackURL` with a machine-readable
 * `?error=<code>` (and sometimes `&error_description=`). Codes come from two
 * places — better-auth's own callback handling and, passed through verbatim,
 * the provider itself (`access_denied`, `redirect_uri_mismatch`, …).
 *
 * Only the codes a user can plausibly hit are spelled out. Everything else
 * falls back to a generic message that still surfaces the raw code, so an
 * unmapped failure is reportable instead of silent.
 */

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
	access_denied: "Google sign-in was cancelled.",
	invalid_id_token: "Google sign-in could not be verified. Try again.",
	account_not_linked:
		"An account with this email address already exists. Sign in with your password first, then connect Google from your account.",
	email_not_found: "Google did not return an email address for this account.",
	invalid_callback_request: "Google sign-in could not be completed. Try again.",
	invalid_code: "Google sign-in expired before it finished. Try again.",
	no_code: "Google sign-in expired before it finished. Try again.",
	oauth_code_verification_failed:
		"Google sign-in could not be verified. Try again.",
	oauth_provider_not_found:
		"Google sign-in is not configured on this server yet.",
	redirect_uri_mismatch:
		"This app's redirect URI is not whitelisted in Google Cloud Console.",
	signup_disabled: "New accounts cannot be created with Google right now.",
	state_mismatch: "Google sign-in could not be verified. Try again.",
	unable_to_create_user: "Your account could not be created. Try again.",
	unable_to_get_user_info: "Google did not return a usable profile.",
	unable_to_link_account:
		"This Google account could not be linked to your account.",
	user_creation_failed: "Your account could not be created. Try again.",
	internal_server_error: "Something went wrong on our side. Try again.",
};

/** Longest `error` / `error_description` value worth keeping from a URL. */
const MAX_LENGTH = 200;

/**
 * Accept an `error` / `error_description` search param, or `undefined` when it
 * is absent or implausible. Values reach the DOM only as text (React escapes
 * them), so the cap is about keeping the UI sane, not about injection.
 */
export function sanitizeOAuthErrorParam(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > MAX_LENGTH) return undefined;
	return trimmed;
}

export function describeOAuthError(code: string, description?: string): string {
	const known = OAUTH_ERROR_MESSAGES[code];
	if (known !== undefined) return known;
	return description !== undefined
		? `Google sign-in failed: ${description} (${code})`
		: `Google sign-in failed (${code}).`;
}

/**
 * Copy for a sign-in that failed *in a response body* rather than in the URL.
 *
 * Google One Tap posts an ID token to `/api/auth/one-tap/callback` and gets
 * JSON back, so its failures never reach `describeOAuthError`. better-auth
 * words them as prose (`"account not linked"`) where the redirect flow uses a
 * code (`account_not_linked`); the two describe the same conditions, so the
 * message is normalised back into a code and looked up in the same table.
 *
 * Anything unmapped is passed through verbatim: better-auth's own wording is
 * already user-readable, and hiding it would make a novel failure unreportable.
 */
export function describeSignInError(message?: string): string {
	const trimmed = message?.trim();
	if (trimmed === undefined || trimmed === "") {
		return "Google sign-in failed. Try again.";
	}

	const code = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
	return OAUTH_ERROR_MESSAGES[code] ?? `Google sign-in failed: ${trimmed}`;
}
