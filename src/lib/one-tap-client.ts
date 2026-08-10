import { oneTapClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { createLogger } from "./logger-client";

/**
 * Google One Tap client.
 *
 * ## Why this is a second better-auth client
 *
 * `oneTapClient()` needs the Google client ID at *construction* time, and the
 * browser only learns it once `fetchSocialProviders()` resolves. Baking it into
 * the bundle instead (a `VITE_`-prefixed variable, or a Vite `define`) would
 * freeze one deploy's client ID into the build and duplicate a value that
 * already lives in `.env`, so the ID is fetched at runtime like every other
 * piece of provider configuration — see `auth-providers.ts`.
 *
 * Running two clients side by side is safe here: the session lives in an
 * HttpOnly cookie on this origin, both clients POST to the same `/api/auth/*`,
 * and the app reads the session through TanStack Query (`session.ts`) rather
 * than through either client's own store. The one thing that does *not* carry
 * over is the plugin's FedCM sign-out hook — `preventSilentAccess()` below
 * exists so the sign-out path can do that job explicitly.
 *
 * The client ID is public by design (it travels in every authorization URL).
 * The client *secret* never leaves the server.
 */

const log = createLogger("auth:one-tap");

function createOneTapAuthClient(clientId: string) {
	return createAuthClient({
		plugins: [
			oneTapClient({
				clientId,

				// Never complete a sign-in the user did not ask for. With
				// `autoSelect` on, a returning visitor is signed in by the mere act
				// of loading the page — which is also what makes a sign-out feel
				// broken, since the next prompt undoes it.
				autoSelect: false,

				context: "signin",

				promptOptions: {
					// The plugin re-prompts with exponential backoff (1s, 2s, 4s, …)
					// whenever Google reports a non-final dismissal. Its `setTimeout`
					// is not cancelled when the page navigates away, so the default of
					// five attempts can surface a prompt half a minute later on an
					// unrelated route. Two attempts bounds that to ~3s.
					baseDelay: 1000,
					maxAttempts: 2,

					// FedCM is what keeps One Tap working as browsers retire
					// third-party cookies. Note it makes the browser, not the page,
					// own the prompt UI: `cancelOnTapOutside` stops applying.
					fedCM: true,
				},
			}),
		],
	});
}

export type OneTapAuthClient = ReturnType<typeof createOneTapAuthClient>;

let cached: { clientId: string; client: OneTapAuthClient } | undefined;

/**
 * Memoized One Tap client for `clientId`.
 *
 * Rebuilt only if the ID changes, so React re-renders and remounts reuse a
 * single Google Identity Services initialization.
 */
export function getOneTapAuthClient(clientId: string): OneTapAuthClient {
	if (cached === undefined || cached.clientId !== clientId) {
		log.debug("creating one-tap auth client", { clientId });
		cached = { clientId, client: createOneTapAuthClient(clientId) };
	}
	return cached.client;
}

/**
 * Tell FedCM to forget the account it auto-selected, so the next prompt asks
 * again instead of silently reusing the identity the user just signed out of.
 *
 * better-auth normally does this from a fetch hook installed on the One Tap
 * client, but sign-out goes through the shared `authClient` in
 * `auth-client.ts`, which does not carry that plugin. Calling this from the
 * sign-out path keeps the guarantee without coupling the two clients.
 *
 * Never rejects: a browser without FedCM has nothing to forget, and a failure
 * to clear the hint must not block the sign-out it is attached to.
 */
export async function preventSilentAccess(): Promise<void> {
	if (typeof window === "undefined") return;

	// FedCM is Chromium-only for now, and `navigator.credentials` is absent
	// outside secure contexts (plain HTTP on a LAN address, for instance).
	if (
		!("IdentityCredential" in window) ||
		navigator.credentials === undefined
	) {
		log.debug("skipping preventSilentAccess", { reason: "fedcm-unavailable" });
		return;
	}

	try {
		await navigator.credentials.preventSilentAccess();
		log.debug("cleared FedCM auto-select hint");
	} catch (error) {
		log.warn("preventSilentAccess failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
