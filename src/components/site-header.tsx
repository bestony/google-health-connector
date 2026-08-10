import { Link } from "@tanstack/react-router";
import { LEGAL } from "../lib/legal";

/**
 * Header mounted on every page by the root route, the counterpart to
 * `SiteFooter`.
 *
 * It carries exactly two things: the wordmark, which is the way back to the
 * home page from the legal documents, and one call to action. The action is
 * singular on purpose — a visitor either has a session or does not, and there
 * is nothing else in this app to navigate to, so a nav bar with more links in
 * it would only be describing pages that do not exist.
 *
 * The signed-in state arrives as a prop rather than being read from the router
 * here: the root shell already holds the session, and keeping this component
 * free of router context makes it renderable — and testable — on its own.
 */

interface SiteHeaderProps {
	/** Whether the visitor has a session. Decides which call to action shows. */
	signedIn: boolean;
	/**
	 * Whether to render the call to action at all.
	 *
	 * `/login` sets this false: a "Sign in" button that navigates to the page the
	 * user is already looking at is a dead control, and offering one next to a
	 * form that does the same thing only makes the real one harder to find.
	 */
	showAction?: boolean;
}

export function SiteHeader({ signedIn, showAction = true }: SiteHeaderProps) {
	return (
		// Sticky rather than static so the way back out of a long legal document
		// is always one click away. The translucent background keeps content
		// visibly scrolling underneath instead of appearing to end at the border.
		<header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
			<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3 sm:px-8">
				<Link
					className="flex items-center gap-2.5 text-base font-semibold tracking-tight transition-opacity hover:opacity-80"
					to="/"
				>
					<AppMark />
					{LEGAL.appName}
				</Link>

				{showAction &&
					(signedIn ? (
						<Link
							className="rounded-md border border-border px-3.5 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
							to="/dashboard"
						>
							Dashboard
						</Link>
					) : (
						<Link
							className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
							to="/login"
							// `/login` reads a `redirect` param and sends the user there
							// after signing in. Arriving from the header is not a bounce off
							// a guarded page, so there is nowhere to return to.
							search={{ redirect: undefined }}
						>
							Sign in
						</Link>
					))}
			</div>
		</header>
	);
}

/** The wordmark's glyph: an ECG trace, drawn rather than shipped as an asset. */
function AppMark() {
	return (
		<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
			<svg
				className="size-4"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M3 12h3.5l2-6 4 12 2.5-6H21" />
			</svg>
		</span>
	);
}
