import { useEffect, useRef } from "react";
import { describeSignInError } from "../lib/auth-errors";
import { createLogger } from "../lib/logger-client";
import { getOneTapAuthClient } from "../lib/one-tap-client";

/**
 * Google One Tap prompt.
 *
 * Renders nothing: the prompt itself is drawn by Google Identity Services (or,
 * under FedCM, by the browser) in its own top-right overlay. Mounting this
 * component is what asks for it.
 *
 * The flow deliberately does *not* redirect. Passing `fetchOptions` makes
 * better-auth skip its built-in `window.location` hop after a successful
 * callback, so the caller can invalidate the session cache and navigate
 * client-side instead — the same soft transition the email form already does.
 *
 * A prompt that never appears is normal and not an error: Google suppresses it
 * when the user has no Google session, has dismissed it too often recently, or
 * when the browser blocks third-party sign-in. The page must therefore keep
 * offering the ordinary "Continue with Google" button; the reason only shows up
 * in the debug log (see `logger-client.ts` for turning that on in production).
 */

const log = createLogger("auth:one-tap");

interface GoogleOneTapProps {
	/** Public Google OAuth client ID, from `fetchSocialProviders()`. */
	clientId: string;
	/** The user picked an account; the ID token is on its way to the server. */
	onStart?: () => void;
	/** The session cookie has been issued. Navigate from here. */
	onSuccess: () => void | Promise<void>;
	/** The server rejected the ID token. Receives ready-to-display copy. */
	onError: (message: string) => void;
}

/**
 * The subset of Google's `PromptMomentNotification` worth logging. Typed
 * structurally rather than imported: Google Identity Services is loaded from
 * their CDN at runtime, so no package declares it.
 */
type PromptMoment = Partial<{
	getMomentType(): string;
	getDismissedReason(): string;
	getSkippedReason(): string;
	getNotDisplayedReason(): string;
}>;

const MOMENT_READERS: ReadonlyArray<readonly [string, keyof PromptMoment]> = [
	["moment", "getMomentType"],
	["dismissedReason", "getDismissedReason"],
	["skippedReason", "getSkippedReason"],
	["notDisplayedReason", "getNotDisplayedReason"],
];

function describePromptMoment(notification: unknown): Record<string, unknown> {
	if (notification === null || typeof notification !== "object") {
		return { notification: String(notification) };
	}

	const moment = notification as PromptMoment;
	const described: Record<string, unknown> = {};

	for (const [label, reader] of MOMENT_READERS) {
		try {
			const value = moment[reader]?.();
			if (value !== undefined) described[label] = value;
		} catch {
			// FedCM deprecated several of these readers, and Google throws from
			// them rather than returning `undefined`. A missing reason is not
			// worth losing the rest of the diagnostics over.
		}
	}

	return described;
}

export function GoogleOneTap({
	clientId,
	onStart,
	onSuccess,
	onError,
}: GoogleOneTapProps) {
	// Google calls back long after the effect that started the prompt, so the
	// handlers are read from a ref instead of captured — otherwise a re-render
	// between the prompt and the tap would leave the callback holding stale
	// props (an outdated `redirect` target, most visibly).
	const handlers = useRef({ onStart, onSuccess, onError });
	useEffect(() => {
		handlers.current = { onStart, onSuccess, onError };
	});

	// `false` only after the component is really gone. Assigning on mount as
	// well as cleanup matters under React StrictMode, which mounts, unmounts and
	// remounts every component in development.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// One prompt per client ID for the lifetime of this component. StrictMode's
	// double-invoked effect would otherwise ask twice, and Google's own
	// suppression counter treats each ask as a dismissal the user did not make.
	const promptedFor = useRef<string | null>(null);

	useEffect(() => {
		if (promptedFor.current === clientId) return;
		promptedFor.current = clientId;

		log.debug("requesting prompt", { clientId });

		void getOneTapAuthClient(clientId)
			.oneTap({
				// No `callbackURL`: combined with `fetchOptions` it is what keeps
				// better-auth from hard-navigating on success.
				fetchOptions: {
					onRequest: () => {
						log.debug("exchanging id token for a session");
						if (mounted.current) handlers.current.onStart?.();
					},
					onSuccess: () => {
						log.info("sign-in succeeded");
						if (mounted.current) void handlers.current.onSuccess();
					},
					onError: ({ error }) => {
						log.error("callback rejected", {
							status: error.status,
							message: error.message,
						});
						if (mounted.current) {
							handlers.current.onError(describeSignInError(error.message));
						}
					},
				},

				// Fires when Google closes the prompt without a credential. Not a
				// failure the user needs told about — the sign-in button below the
				// prompt is the fallback — so it is logged and nothing more.
				onPromptNotification: (notification) => {
					log.debug("prompt closed without a credential", {
						...describePromptMoment(notification),
					});
				},
			})
			.catch((error: unknown) => {
				// Reached when Google's script cannot be loaded at all: offline, or
				// blocked by an extension or a content-blocking DNS resolver.
				log.warn("prompt could not be shown", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	}, [clientId]);

	return null;
}
