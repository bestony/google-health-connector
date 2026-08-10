import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { GoogleHealthAccess } from "../lib/google-health-access";
import { requestGoogleHealthAccess } from "../lib/google-health-client";
import {
	GOOGLE_HEALTH_DATA_TYPES,
	GOOGLE_HEALTH_SCOPES,
	type GoogleHealthAccessLevel,
	type GoogleHealthDataType,
	googleHealthScope,
} from "../lib/google-health-scopes";
import { LEGAL_LINKS } from "../lib/legal";

/**
 * The Google Health authorization card on the dashboard.
 *
 * One button asks for every scope in `google-health-scopes.ts` in a single
 * consent screen; the list below it reports what Google actually came back
 * with, which is not the same thing — the consent screen lets the user untick
 * individual permissions, and this is where that shows up.
 *
 * The button stays available once everything is granted: re-running it is how a
 * user restores an access that was revoked from their Google account settings,
 * and how a new scope added to the catalog gets picked up.
 *
 * The disclosure above the button is not filler. Google's OAuth verification
 * requires a prominent, in-product explanation of what health data is accessed
 * and what happens to it, shown *before* the consent screen is requested rather
 * than only in a linked policy — so it has to sit here, next to the action that
 * triggers the request.
 */

interface GoogleHealthAuthorizationProps {
	/** What the server knows about this user's Google grant. */
	access: GoogleHealthAccess;
	/** Signed-in user's email, passed to Google as `login_hint`. */
	loginHint: string;
	/** Same-origin path Google returns to on success. */
	callbackURL: string;
	/** Same-origin path better-auth bounces to with `?error=` on failure. */
	errorCallbackURL: string;
	/** Copy for a failure that came back through the URL. */
	error?: string | null;
	/** Whether this page load is the one Google just redirected back to. */
	justAuthorized?: boolean;
}

export function GoogleHealthAuthorization({
	access,
	loginHint,
	callbackURL,
	errorCallbackURL,
	error = null,
	justAuthorized = false,
}: GoogleHealthAuthorizationProps) {
	const [requestError, setRequestError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	// Same precedence as `/login`: whatever this page just tried wins over the
	// stale message the last redirect left in the URL.
	const message = requestError ?? error;

	const granted = new Set(
		access.status === "linked" ? access.grantedScopes : [],
	);
	const grantedCount = GOOGLE_HEALTH_SCOPES.filter((scope) =>
		granted.has(scope),
	).length;

	async function onAuthorize() {
		setRequestError(null);
		setPending(true);

		const failure = await requestGoogleHealthAccess({
			callbackURL,
			errorCallbackURL,
			loginHint,
		});

		// On success the browser is already navigating to Google, so the button is
		// left pending on purpose instead of flashing back to idle.
		if (failure !== null) {
			setRequestError(failure);
			setPending(false);
		}
	}

	return (
		<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
			<header className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-lg font-semibold">Google Health</h2>
				<StatusBadge access={access} grantedCount={grantedCount} />
			</header>

			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				Grant this app access to your Google Health data so it can read it — and
				write back what it records — through the Google Health APIs. Google asks
				for every permission below in one consent screen, and you can untick any
				of them there.
			</p>

			<div className="mt-3 max-w-prose rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
				<p>
					<strong className="text-foreground">
						Before you grant this, here is what happens to the data.
					</strong>{" "}
					We read the categories you leave ticked and store a copy on our
					servers so your history stays available to you. We never sell it, use
					it for advertising, or hand it to anyone else for their own purposes.
					It leaves our servers only when you connect an MCP client yourself.
				</p>
				<p className="mt-2">
					You can withdraw this at any time — from{" "}
					<a
						className="underline underline-offset-2"
						href={LEGAL_LINKS.googlePermissions}
						rel="noopener noreferrer"
						target="_blank"
					>
						your Google account permissions
					</a>{" "}
					— and ask us to delete the stored copy. Full detail in the{" "}
					<Link className="underline underline-offset-2" to="/privacy">
						Privacy Policy
					</Link>
					.
				</p>
			</div>

			{access.status === "disabled" ? (
				<p className="mt-4 text-sm text-muted-foreground">
					Google sign-in is not configured on this server, so there is nothing
					to authorize. Set <code className="font-mono">GOOGLE_CLIENT_ID</code>{" "}
					and <code className="font-mono">GOOGLE_CLIENT_SECRET</code>, then
					reload.
				</p>
			) : (
				<div className="mt-4 flex flex-wrap items-center gap-3">
					<button
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						onClick={onAuthorize}
						disabled={pending}
					>
						{pending
							? "Redirecting to Google…"
							: grantedCount === 0
								? "Authorize Google Health"
								: "Update Google Health permissions"}
					</button>

					<span className="text-sm text-muted-foreground">
						{grantedCount} of {GOOGLE_HEALTH_SCOPES.length} permissions granted
					</span>
				</div>
			)}

			{access.status === "unavailable" && (
				<p className="mt-3 text-sm text-muted-foreground">
					Your current permissions could not be read, so the list below may be
					out of date. Authorizing again is safe either way.
				</p>
			)}

			{/* Returning from Google is not the same as being granted anything: the
			    consent screen's checkboxes are the user's, so the count above is the
			    only honest report of what happened. */}
			{justAuthorized && message === null && (
				<p className="mt-3 text-sm text-muted-foreground">
					Google Health authorization completed. The permissions below are what
					Google granted.
				</p>
			)}

			{message && <p className="mt-3 text-sm text-destructive">{message}</p>}

			<details className="mt-5">
				<summary className="cursor-pointer text-sm font-medium">
					Permissions
				</summary>

				<ul className="mt-3 flex flex-col gap-3">
					{GOOGLE_HEALTH_DATA_TYPES.map((dataType) => (
						<li
							className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border pb-3 last:border-b-0"
							key={dataType.id}
						>
							<div className="min-w-0">
								<p className="text-sm font-medium">{dataType.label}</p>
								<p className="text-sm text-muted-foreground">
									{dataType.description}
								</p>
								<p className="mt-0.5 font-mono text-xs text-muted-foreground">
									googlehealth.{dataType.id}
								</p>
							</div>

							<div className="flex shrink-0 gap-2">
								<ScopeChip
									access="read"
									dataType={dataType}
									granted={granted}
								/>
								{dataType.writable && (
									<ScopeChip
										access="write"
										dataType={dataType}
										granted={granted}
									/>
								)}
							</div>
						</li>
					))}
				</ul>
			</details>
		</section>
	);
}

function StatusBadge({
	access,
	grantedCount,
}: {
	access: GoogleHealthAccess;
	grantedCount: number;
}) {
	const label = (() => {
		switch (access.status) {
			case "disabled":
				return "Google sign-in off";
			case "unavailable":
				return "Status unknown";
			case "unlinked":
				return "Not connected";
			default:
				return grantedCount === 0
					? "Connected, no data access"
					: grantedCount === GOOGLE_HEALTH_SCOPES.length
						? "All permissions granted"
						: "Some permissions granted";
		}
	})();

	const connected =
		access.status === "linked" && grantedCount === GOOGLE_HEALTH_SCOPES.length;

	return (
		<span
			className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
				connected
					? "border-primary/40 bg-accent text-accent-foreground"
					: "border-border text-muted-foreground"
			}`}
		>
			{label}
		</span>
	);
}

/**
 * One read or write permission, marked granted or not.
 *
 * The full scope URL is on `title` rather than on screen: it is what a
 * developer needs when wiring up an API call, and it is far too long to sit in
 * a row that already carries a label and a description.
 */
function ScopeChip({
	access,
	dataType,
	granted,
}: {
	access: GoogleHealthAccessLevel;
	dataType: GoogleHealthDataType;
	granted: ReadonlySet<string>;
}) {
	const scope = googleHealthScope(dataType.id, access);
	const isGranted = granted.has(scope);

	return (
		<span
			className={`rounded border px-2 py-0.5 text-xs font-medium ${
				isGranted
					? "border-primary/40 bg-accent text-accent-foreground"
					: "border-border text-muted-foreground"
			}`}
			title={scope}
		>
			{isGranted ? "✓ " : ""}
			{access === "read" ? "Read" : "Write"}
		</span>
	);
}
