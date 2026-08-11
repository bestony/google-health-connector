import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "./auth.server";
import { isGoogleHealthScope } from "./google-health-scopes";
import { createLogger } from "./logger.server";

/**
 * Server-side access tokens for the Google Health APIs.
 *
 * This is the other half of the authorize button: once the user has granted the
 * scopes, everything that calls Google on their behalf goes through here.
 * better-auth owns the refresh — it decrypts the stored refresh token, renews
 * the access token when it is within five seconds of expiry and writes the new
 * pair back — so callers never touch `account.refreshToken` themselves.
 *
 * Server-only: it reads the request's session cookie and decrypts tokens with
 * `BETTER_AUTH_SECRET`. Never import it from a component.
 *
 * Most callers want `createGoogleHealthClient()` from
 * `google-health-api.server.ts`, which goes through this and then knows the
 * paths, filters and pagination. Reach for the token itself only for something
 * the client does not wrap:
 *
 * ```ts
 * const { accessToken } = await getGoogleHealthAccessToken({
 *   requiredScopes: [googleHealthScope("sleep", "read")],
 * });
 *
 * const response = await fetch("https://health.googleapis.com/v4/…", {
 *   headers: { Authorization: `Bearer ${accessToken}` },
 * });
 * ```
 */

const log = createLogger("google-health:token");

/** better-auth's provider id for Google. Matches `socialProviders.google`. */
const GOOGLE_PROVIDER_ID = "google";

export interface GoogleHealthAccessToken {
	/** Bearer token for `Authorization`. Valid at the moment it is returned. */
	accessToken: string;
	/** When it stops being valid, when Google said so. */
	expiresAt: Date | undefined;
	/** The Google Health scopes the user actually granted. */
	grantedScopes: string[];
}

/**
 * Thrown when the user cannot be called for on Google's behalf: no linked
 * account, a refresh that failed, or scopes that were never granted.
 *
 * `missingScopes` is what the UI needs to re-run the authorization with, so it
 * is carried on the error rather than left for the caller to recompute.
 */
export class GoogleHealthAuthorizationError extends Error {
	readonly missingScopes: readonly string[];

	constructor(
		message: string,
		missingScopes: readonly string[] = [],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "GoogleHealthAuthorizationError";
		this.missingScopes = missingScopes;
	}
}

function resolveAccessToken(userId: string | undefined) {
	if (userId === undefined) {
		return getAuth().api.getAccessToken({
			body: { providerId: GOOGLE_PROVIDER_ID },
			headers: getRequest().headers,
		});
	}

	return getAuth().api.getAccessToken({
		body: { providerId: GOOGLE_PROVIDER_ID, userId },
	});
}

export interface GetGoogleHealthAccessTokenOptions {
	/**
	 * Scopes the call about to be made needs. Checked against what Google
	 * returned at consent time, so a scope the user unticked fails here rather
	 * than as an opaque 403 from the API.
	 */
	requiredScopes?: readonly string[];
	/**
	 * Act for this user instead of whoever the request's session belongs to.
	 *
	 * This is what lets `/mcp` reach Google: an MCP request carries an API key or
	 * OAuth access token, not a session cookie. Either credential resolves to a
	 * user id, and that is enough.
	 */
	userId?: string;
}

/**
 * A currently-valid Google access token for the signed-in user.
 *
 * Throws `GoogleHealthAuthorizationError` when there is nothing to call with;
 * every other failure (no session, provider misconfigured) propagates as
 * better-auth's own `APIError`.
 */
export async function getGoogleHealthAccessToken({
	requiredScopes = [],
	userId,
}: GetGoogleHealthAccessTokenOptions = {}): Promise<GoogleHealthAccessToken> {
	let token: Awaited<
		ReturnType<ReturnType<typeof getAuth>["api"]["getAccessToken"]>
	>;

	try {
		// The two call shapes are mutually exclusive, and not by preference.
		// better-auth resolves the user from the session when headers are present
		// and answers UNAUTHORIZED if there is none — so passing headers *and* a
		// `userId` would fail for exactly the callers the `userId` exists for.
		// Anything that later "tidies this up" by always passing headers breaks
		// `/mcp` and nothing else, which is a hard bug to find.
		token = await Promise.resolve(resolveAccessToken(userId));
	} catch (error) {
		// better-auth collapses "no linked account" and "the refresh call failed"
		// into BAD_REQUEST. Both mean the same thing to a caller: send the user
		// back through the consent screen.
		log.error("could not obtain a google access token", {
			userId: userId ?? null,
			error: error instanceof Error ? error.message : String(error),
		});
		// The custom error stores the original failure in `cause`; the explicit
		// suppression keeps Biome from treating this domain error as a plain Error.
		// biome-ignore lint/nursery/useErrorCause: cause is passed through the custom error constructor
		throw new GoogleHealthAuthorizationError(
			"No usable Google authorization. Ask the user to reconnect Google Health.",
			requiredScopes,
			{ cause: error },
		);
	}

	const grantedScopes = (token.scopes ?? []).filter(isGoogleHealthScope);
	const missingScopes = requiredScopes.filter(
		(scope) => !grantedScopes.includes(scope),
	);

	if (missingScopes.length > 0) {
		log.warn("google access token is missing required scopes", {
			missingScopes,
			grantedScopes: grantedScopes.length,
		});
		throw new GoogleHealthAuthorizationError(
			`Google Health scopes were never granted: ${missingScopes.join(", ")}`,
			missingScopes,
		);
	}

	if (!token.accessToken) {
		log.error("google returned an empty access token");
		throw new GoogleHealthAuthorizationError(
			"Google returned an empty access token. Ask the user to reconnect Google Health.",
			requiredScopes,
		);
	}

	log.debug("resolved google access token", {
		expiresAt: token.accessTokenExpiresAt?.toISOString?.() ?? null,
		grantedScopes: grantedScopes.length,
	});

	return {
		accessToken: token.accessToken,
		expiresAt: token.accessTokenExpiresAt,
		grantedScopes,
	};
}
