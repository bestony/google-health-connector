import { Link } from "@tanstack/react-router";
import { GOOGLE_HEALTH_DATA_TYPES } from "../lib/google-health-scopes";
import { LEGAL, LEGAL_LINKS } from "../lib/legal";

/**
 * The home page's only section.
 *
 * It has one job: say what the app does and start the one flow it offers. The
 * proof points below the buttons are derived from the scope catalog rather than
 * written out, so the number on the landing page cannot drift away from the
 * number of permissions the consent screen actually asks for — a mismatch there
 * is the kind of thing Google's OAuth review reads as a misrepresentation.
 *
 * Like `SiteHeader`, the signed-in state is a prop, so this renders on its own.
 */

interface HeroProps {
	/** Whether the visitor has a session. Decides the primary call to action. */
	signedIn: boolean;
}

/**
 * The claims under the buttons. Each one is a fact the rest of the app has to
 * keep true, not a marketing line: the count comes from the catalog, read and
 * write are separate grants on the consent screen, and revocation happens in
 * the user's Google account settings — the same promise the privacy policy
 * makes.
 */
const HIGHLIGHTS: readonly string[] = [
	`${GOOGLE_HEALTH_DATA_TYPES.length} health data categories`,
	"Read and write access",
	"Revoke anytime in your Google account",
];

export function Hero({ signedIn }: HeroProps) {
	return (
		<section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center sm:px-8 sm:py-28">
			<p className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
				<span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
				Google Health, connected to your AI
			</p>

			<h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-balance sm:text-5xl">
				Your Google Health data,{" "}
				<span className="text-primary">readable by any AI</span>.
			</h1>

			<p className="mt-5 max-w-xl text-lg leading-8 text-pretty text-muted-foreground">
				{LEGAL.appName} links your Google Health account once, then serves it
				over the open Model Context Protocol — so any AI app or agent you choose
				can read your sleep, workouts and vitals, and answer questions about
				them.
			</p>

			<div className="mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
				{signedIn ? (
					<Link
						className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
						to="/dashboard"
					>
						Open dashboard
					</Link>
				) : (
					<Link
						className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
						to="/login"
						search={{ redirect: undefined }}
					>
						Connect Google Health
					</Link>
				)}

				{/* The protocol is the part a visitor is least likely to know, and the
				    explanation belongs to the standard rather than to us. */}
				<a
					className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
					href={LEGAL_LINKS.modelContextProtocol}
					rel="noopener noreferrer"
					target="_blank"
				>
					What is MCP?
				</a>
			</div>

			<ul className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
				{HIGHLIGHTS.map((highlight, index) => (
					<li className="flex items-center gap-3" key={highlight}>
						{index > 0 && (
							<span
								aria-hidden="true"
								className="size-1 rounded-full bg-border"
							/>
						)}
						{highlight}
					</li>
				))}
			</ul>
		</section>
	);
}
