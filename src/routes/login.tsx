import {
	createFileRoute,
	Link,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { GoogleOneTap } from "../components/google-one-tap";
import { GoogleSignInButton } from "../components/google-sign-in-button";
import { authClient } from "../lib/auth-client";
import {
	describeOAuthError,
	sanitizeOAuthErrorParam,
} from "../lib/auth-errors";
import { socialProvidersQueryOptions } from "../lib/auth-providers";

/**
 * Demo sign-in / sign-up screen for the email + password and Google providers.
 *
 * It is intentionally plain: it exists to exercise the better-auth wiring end
 * to end. Replace or restyle it freely — nothing else depends on this file.
 */

type Mode = "signin" | "signup";

/**
 * Only same-origin, absolute paths are accepted. Anything else (`//evil.com`,
 * `https://evil.com`) is dropped so the redirect cannot be used as an open
 * redirect after a successful login.
 */
function sanitizeRedirect(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	if (!value.startsWith("/") || value.startsWith("//")) return undefined;
	return value;
}

/**
 * `error` / `error_description` are set by better-auth when it bounces a failed
 * OAuth flow back here (see `errorCallbackURL` below).
 *
 * Every key is optional and omitted when absent, rather than emitted as
 * `undefined`: TanStack derives the type callers must pass to `<Link search>`
 * from this shape, and nothing linking to `/login` should have to name the
 * OAuth params just to satisfy it.
 */
interface LoginSearch {
	redirect?: string;
	error?: string;
	error_description?: string;
	/** A signed authorization request must remain on this page after sign-in. */
	oauth?: true;
}

function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
	const result: LoginSearch = {};

	const to = sanitizeRedirect(search.redirect);
	if (to !== undefined) result.redirect = to;

	const error = sanitizeOAuthErrorParam(search.error);
	if (error !== undefined) result.error = error;

	const description = sanitizeOAuthErrorParam(search.error_description);
	if (description !== undefined) result.error_description = description;

	if (typeof search.sig === "string" && search.sig.length > 0) {
		result.oauth = true;
	}

	return result;
}

/** Whether better-auth has already started a full-page OAuth redirect. */
function isAuthRedirectResponse(
	value: unknown,
): value is { redirect: true; url: string } {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { redirect?: unknown; url?: unknown };
	return candidate.redirect === true && typeof candidate.url === "string";
}

export const Route = createFileRoute("/login")({
	validateSearch: validateLoginSearch,
	beforeLoad: ({ context, search }) => {
		if (context.session && search.oauth !== true) {
			throw redirect({ to: search.redirect ?? "/dashboard" });
		}
	},
	// Which social buttons to render depends on the server's credentials, so it
	// has to be resolved before paint rather than guessed in the browser.
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(socialProvidersQueryOptions()),
	component: LoginPage,
});

function LoginPage() {
	const router = useRouter();
	const { queryClient } = Route.useRouteContext();
	const search = Route.useSearch();
	const providers = Route.useLoaderData();

	const [mode, setMode] = useState<Mode>("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [googlePending, setGooglePending] = useState(false);
	// One Tap runs on its own, without anything on this page being clicked, so
	// it needs its own flag: the form has to lock while the ID token is being
	// redeemed, but the "Continue with Google" button must not claim it is
	// redirecting when it is not.
	const [oneTapPending, setOneTapPending] = useState(false);

	// A failed OAuth round trip lands here as a query param, so it has to be read
	// from the URL rather than from the form's own error state.
	const oauthError =
		search.error !== undefined
			? describeOAuthError(search.error, search.error_description)
			: null;
	const message = error ?? oauthError;

	/**
	 * Leave the login page once a session cookie exists.
	 *
	 * Shared by every flow that signs in without a full page load — the email
	 * form and Google One Tap. The cookie changed underneath the cached session,
	 * so it is dropped before the router re-runs `beforeLoad` with the new one.
	 *
	 * Dropped, not invalidated. Invalidation marks a query stale and refetches
	 * the ones something is observing, and nothing observes this one: the root
	 * route reads it through `ensureQueryData`, which returns whatever is cached
	 * without caring that it went stale. The cached value here is the `null`
	 * from before signing in, so `beforeLoad` would re-run, still see no
	 * session, and `/dashboard` would bounce straight back to this page.
	 *
	 * The whole cache goes, not just the session entry: whoever was signed in
	 * before may have left per-user answers behind, and this navigation is the
	 * moment they would be read back as the new user's.
	 */
	async function completeSignIn(response: unknown) {
		// The default better-auth redirect plugin has already assigned
		// `window.location.href`; any router navigation here could win the race and
		// discard the signed authorization continuation.
		if (isAuthRedirectResponse(response)) return;

		queryClient.clear();
		await router.invalidate();
		await router.navigate({ to: search.redirect ?? "/dashboard" });
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setPending(true);

		const result =
			mode === "signin"
				? await authClient.signIn.email({ email, password })
				: await authClient.signUp.email({ name, email, password });

		setPending(false);

		if (result.error) {
			setError(result.error.message ?? "Authentication failed.");
			return;
		}

		await completeSignIn(result.data);
	}

	async function onGoogleSignIn() {
		setError(null);
		setGooglePending(true);

		// Both callbacks are same-origin paths handled by this app: on success
		// Google's callback endpoint issues the session cookie and redirects
		// straight to `callbackURL`, so there is no cache to invalidate here — the
		// browser does a full navigation and the router re-reads the session on
		// the server. On failure better-auth appends `?error=` to
		// `errorCallbackURL`; keep `redirect` on it so a retry still honours it.
		const target = search.redirect ?? "/dashboard";
		const errorCallbackURL =
			search.redirect !== undefined
				? `/login?redirect=${encodeURIComponent(search.redirect)}`
				: "/login";

		const { error: signInError } = await authClient.signIn.social({
			provider: "google",
			callbackURL: target,
			newUserCallbackURL: target,
			errorCallbackURL,
		});

		// On success the browser is already navigating to Google, so the button is
		// left pending on purpose instead of flashing back to idle.
		if (signInError) {
			setError(signInError.message ?? "Could not start Google sign-in.");
			setGooglePending(false);
		}
	}

	const busy = pending || googlePending || oneTapPending;

	return (
		<div className="mx-auto max-w-sm p-8">
			<h1 className="text-2xl font-bold">
				{mode === "signin" ? "Sign in" : "Create an account"}
			</h1>

			{providers.googleClientId !== null && (
				// One Tap asks Google directly, in an overlay this page does not
				// own, and stays silent when Google declines to show it. The button
				// below is the fallback and is always rendered.
				<GoogleOneTap
					clientId={providers.googleClientId}
					onStart={() => {
						setError(null);
						setOneTapPending(true);
					}}
					onSuccess={completeSignIn}
					onError={(message) => {
						setError(message);
						setOneTapPending(false);
					}}
				/>
			)}

			{providers.google && (
				<>
					<div className="mt-6">
						<GoogleSignInButton
							onClick={onGoogleSignIn}
							pending={googlePending}
							disabled={pending || oneTapPending}
						/>
					</div>

					<div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
						<span className="h-px flex-1 bg-border" />
						or
						<span className="h-px flex-1 bg-border" />
					</div>
				</>
			)}

			<form
				className={`flex flex-col gap-3 ${providers.google ? "" : "mt-6"}`}
				onSubmit={onSubmit}
			>
				{mode === "signup" && (
					<label className="flex flex-col gap-1 text-sm">
						Name
						<input
							className="rounded border px-3 py-2"
							value={name}
							onChange={(event) => setName(event.target.value)}
							required
						/>
					</label>
				)}

				<label className="flex flex-col gap-1 text-sm">
					Email
					<input
						className="rounded border px-3 py-2"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						required
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm">
					Password
					<input
						className="rounded border px-3 py-2"
						type="password"
						autoComplete={
							mode === "signin" ? "current-password" : "new-password"
						}
						minLength={8}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						required
					/>
				</label>

				{oneTapPending && (
					<p className="text-sm text-muted-foreground">
						Signing you in with Google…
					</p>
				)}

				{message && <p className="text-sm text-red-600">{message}</p>}

				<button
					className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
					type="submit"
					disabled={busy}
				>
					{pending ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
				</button>
			</form>

			<button
				className="mt-4 text-sm underline"
				type="button"
				onClick={() => {
					setMode(mode === "signin" ? "signup" : "signin");
					setError(null);
				}}
			>
				{mode === "signin"
					? "Need an account? Sign up"
					: "Already registered? Sign in"}
			</button>

			{/* The moment consent is actually given, so the notice belongs here and
			    not only in the site footer: signing in is what forms the agreement,
			    and Google's OAuth review looks for both documents to be reachable
			    from the screen that starts the flow. */}
			<p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
				By continuing you agree to our{" "}
				<Link className="underline" to="/terms">
					Terms of Service
				</Link>{" "}
				and{" "}
				<Link className="underline" to="/privacy">
					Privacy Policy
				</Link>
				.
			</p>
		</div>
	);
}
