import { Link } from "@tanstack/react-router";
import { LEGAL, LEGAL_CONTACT_MAILTO } from "../lib/legal";

/**
 * Footer mounted on every page by the root route.
 *
 * It is not decoration. Google's OAuth verification requires the privacy policy
 * to be reachable from the app's home page, on the same origin, without signing
 * in — putting the links in the root shell is what guarantees that stays true
 * for every route, including any added later.
 *
 * The year is a constant from `legal.ts` rather than `new Date()`: a value read
 * at render time differs between the server and the browser across a New Year
 * boundary, which is a hydration mismatch for no benefit.
 */
export function SiteFooter() {
	return (
		<footer className="border-t border-border">
			<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-8 py-6 text-sm text-muted-foreground">
				<p>
					© {LEGAL.copyrightYear} {LEGAL.appName}
				</p>

				<nav className="flex flex-wrap gap-x-6 gap-y-2">
					<Link className="hover:text-foreground" to="/privacy">
						Privacy Policy
					</Link>
					<Link className="hover:text-foreground" to="/terms">
						Terms of Service
					</Link>
					<a className="hover:text-foreground" href={LEGAL_CONTACT_MAILTO}>
						Contact
					</a>
				</nav>
			</div>
		</footer>
	);
}
