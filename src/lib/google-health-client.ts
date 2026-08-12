import { authClient } from "./auth-client";
import { describeSignInError } from "./auth-errors";
import { GOOGLE_HEALTH_SCOPES } from "./google-health-scopes";
import { createLogger } from "./logger";

/**
 * Browser-side entry point for the Google Health authorization round trip.
 *
 * It goes through better-auth's `/link-social` rather than `/sign-in/social`
 * because the user is *already* signed in: linking attaches the new grant to
 * the existing account row (and its refresh token) instead of minting a second
 * session, and it is the only endpoint that accepts extra `scopes`.
 *
 * Google is told to include already-granted scopes (`include_granted_scopes`,
 * set by better-auth's Google provider), so this is incremental authorization:
 * asking for sleep data does not revoke the activity grant from last week.
 */

const log = createLogger("google-health:authorize");

export interface RequestGoogleHealthAccessOptions {
	/** Scopes to ask for. Defaults to the whole catalog. */
	scopes?: readonly string[];
	/** Same-origin path Google returns to once the user has decided. */
	callbackURL: string;
	/** Same-origin path better-auth bounces to with `?error=` on failure. */
	errorCallbackURL: string;
	/**
	 * Email of the signed-in user, passed to Google as `login_hint`.
	 *
	 * Google rejects nothing on the strength of a hint, but it preselects the
	 * matching account. Without it a user signed into several Google accounts
	 * can pick a different one, and better-auth then fails the callback with
	 * `email_doesn't_match` after the consent screen has already been filled in.
	 */
	loginHint?: string;
}

/**
 * Start the authorization flow.
 *
 * Resolves to `null` once the browser is on its way to Google — the page is
 * navigating at that point and the caller should leave its button pending —
 * or to a ready-to-display message when the request never got that far.
 */
export async function requestGoogleHealthAccess({
	scopes = GOOGLE_HEALTH_SCOPES,
	callbackURL,
	errorCallbackURL,
	loginHint,
}: RequestGoogleHealthAccessOptions): Promise<string | null> {
	log.info("requesting google health authorization", {
		scopes: scopes.length,
		callbackURL,
	});

	const { data, error } = await authClient.linkSocial({
		provider: "google",
		scopes: [...scopes],
		callbackURL,
		errorCallbackURL,

		// The client's built-in redirect hook would send the browser to `data.url`
		// verbatim. The URL needs the two parameters below added first, so the hop
		// is done here instead.
		disableRedirect: true,
	});

	if (error) {
		log.error("could not build the authorization url", {
			status: error.status,
			message: error.message,
		});
		return describeSignInError(error.message);
	}

	if (!data?.url) {
		log.error("authorization url missing from the response", { data });
		return "Google authorization could not be started. Try again.";
	}

	let target: string;
	try {
		target = prepareAuthorizationUrl(data.url, loginHint);
	} catch (cause) {
		log.error("rejected the authorization url", {
			url: data.url,
			error: cause instanceof Error ? cause.message : String(cause),
		});
		return "Google authorization could not be started. Try again.";
	}

	log.debug("redirecting to google", { target });
	window.location.href = target;
	return null;
}

/**
 * Add the two parameters better-auth's `/link-social` cannot be told to set.
 *
 * `prompt=consent` overrides the provider-level `select_account` used for
 * sign-in, which is the wrong prompt here on both counts:
 *
 *  - The account is not up for choosing. This flow links to the account already
 *    on the session, and Google coming back with a different one fails the
 *    callback outright.
 *  - Google only issues a refresh token when the consent screen is actually
 *    shown. It normally skips consent for scopes already granted, so a repeat
 *    authorization would come back with an access token that dies in an hour
 *    and nothing to renew it with — the one thing a connector cannot afford.
 *
 * `login_hint` preselects the signed-in user's account; see `loginHint` above.
 *
 * Throws when the URL is not an absolute `https:` one. It comes from this app's
 * own API and is built from a hard-coded Google endpoint, so that can only mean
 * the response was tampered with — and this function's next act is a
 * navigation.
 */
function prepareAuthorizationUrl(
	authorizationUrl: string,
	loginHint?: string,
): string {
	const url = new URL(authorizationUrl);
	if (url.protocol !== "https:") {
		throw new Error(`refusing to navigate to ${url.protocol}//`);
	}

	url.searchParams.set("prompt", "consent");
	if (loginHint !== undefined) url.searchParams.set("login_hint", loginHint);

	return url.toString();
}
