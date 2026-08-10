import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { SESSION_QUERY_KEY } from "../lib/session";

/**
 * Demo route protected by the better-auth session.
 *
 * The guard lives in `beforeLoad` and reads the session that the root route
 * resolved on the server, so an unauthenticated visitor is redirected before
 * any of this component is sent to the browser.
 */

export const Route = createFileRoute("/dashboard")({
	beforeLoad: ({ context, location }) => {
		if (!context.session) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		return { session: context.session };
	},
	component: DashboardPage,
});

function DashboardPage() {
	const router = useRouter();
	const { session, queryClient } = Route.useRouteContext();
	const [pending, setPending] = useState(false);

	async function onSignOut() {
		setPending(true);
		await authClient.signOut();
		await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
		await router.invalidate();
		await router.navigate({ to: "/login", search: { redirect: undefined } });
	}

	return (
		<div className="p-8">
			<h1 className="text-2xl font-bold">Dashboard</h1>

			<dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
				<dt className="font-medium">User ID</dt>
				<dd>{session.user.id}</dd>
				<dt className="font-medium">Name</dt>
				<dd>{session.user.name}</dd>
				<dt className="font-medium">Email</dt>
				<dd>{session.user.email}</dd>
				<dt className="font-medium">Email verified</dt>
				<dd>{String(session.user.emailVerified)}</dd>
				<dt className="font-medium">Session expires</dt>
				<dd>{new Date(session.session.expiresAt).toISOString()}</dd>
			</dl>

			<button
				className="mt-6 rounded bg-black px-3 py-2 text-white disabled:opacity-50"
				type="button"
				onClick={onSignOut}
				disabled={pending}
			>
				{pending ? "Signing out…" : "Sign out"}
			</button>
		</div>
	);
}
