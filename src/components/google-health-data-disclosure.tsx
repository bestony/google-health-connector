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
				We read the categories you leave ticked directly from Google when you or
				an MCP client you connect makes a request. We do not store a copy of
				your health records on our servers. We never sell the data, use it for
				advertising, or hand it to anyone else for their own purposes. We send
				it to an MCP client only when you connect that client yourself.
			</p>
			<p className="mt-2">
				You can stop future access at any time: remove this Service from{" "}
				<a
					className="underline underline-offset-2"
					href={LEGAL_LINKS.googlePermissions}
					rel="noopener noreferrer"
					target="_blank"
				>
					your Google account permissions
				</a>
				, revoke an OAuth application under Connected apps, or revoke your API
				key. Revocation cannot remove data that an MCP client already received.
				Full detail is in the{" "}
				<Link className="underline underline-offset-2" to="/privacy">
					Privacy Policy
				</Link>
				.
			</p>
		</div>
	);
}
