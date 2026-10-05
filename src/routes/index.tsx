import { createFileRoute } from "@tanstack/react-router";
import { Features } from "../components/features";
import { Hero } from "../components/hero";

/**
 * Home page: what the product does.
 *
 * The header and footer are mounted by the root shell. It is also the page
 * Google's OAuth review starts from, which is why the shell — and with it the
 * privacy policy link — has to stay where it is rather than being folded in
 * here.
 */

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const { session } = Route.useRouteContext();

	return (
		<>
			<Hero signedIn={session !== null} />
			<Features />
		</>
	);
}
