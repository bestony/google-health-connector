import { Link } from "@tanstack/react-router";
import { LEGAL_LINKS } from "../lib/legal";

/**
 * The in-product Google Health disclosure shown before data access is granted.
 *
 * Keep this shared between Google's authorization action and the MCP consent
 * action. The Limited Use promise must not change depending on which button a
 * user is about to press.
 */
export function GoogleHealthDataDisclosure() {
	return (
		<div className="mt-3 max-w-prose rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
			<p>
				<strong className="text-foreground">
					Before you grant this, here is what happens to the data.
				</strong>{" "}
				We read the categories you leave ticked and store a copy on our servers
				so your history stays available to you. We never sell it, use it for
				advertising, or hand it to anyone else for their own purposes. It leaves
				our servers only when you connect an MCP client yourself.
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
	);
}
