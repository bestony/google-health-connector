import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { GoogleHealthAuthorization } from "../components/google-health-authorization";
import { authClient } from "../lib/auth-client";
import {
	describeOAuthError,
	sanitizeOAuthErrorParam,
} from "../lib/auth-errors";
import { googleHealthAccessQueryOptions } from "../lib/google-health-access";
import { preventSilentAccess } from "../lib/one-tap-client";
import { SESSION_QUERY_KEY } from "../lib/session";

/**
 * Demo route protected by the better-auth session.
 *
 * The guard lives in `beforeLoad` and reads the session that the root route
 * resolved on the server, so an unauthenticated visitor is redirected before
 * any of this component is sent to the browser.
 *
 * It is also where the Google Health authorization round trip lands: Google
 * redirects back here with `?health=granted`, or better-auth bounces here with
 * `?error=` when the link could not be completed.
 */

/** Where Google returns once the user has answered the consent screen. */
const HEALTH_CALLBACK_URL = "/dashboard?health=granted";

/** Where better-auth bounces to with `?error=` when the link fails. */
const HEALTH_ERROR_CALLBACK_URL = "/dashboard";

/**
 * Every key is optional and omitted when absent, rather than emitted as
 * `undefined`, for the same reason as on `/login`: TanStack derives the type
 * callers must pass to `<Link search>` from this shape.
 */
interface DashboardSearch {
	error?: string;
	error_description?: string;
	health?: "granted";
}

function validateDashboardSearch(
	search: Record<string, unknown>,
): DashboardSearch {
	const result: DashboardSearch = {};

	const error = sanitizeOAuthErrorParam(search.error);
	if (error !== undefined) result.error = error;

	const description = sanitizeOAuthErrorParam(search.error_description);
	if (description !== undefined) result.error_description = description;

	if (search.health === "granted") result.health = "granted";

	return result;
}

export const Route = createFileRoute("/dashboard")({
	validateSearch: validateDashboardSearch,
	beforeLoad: ({ context, location }) => {
		if (!context.session) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		return { session: context.session };
	},
	// What the user has already granted decides the whole card — its badge, its
	// button label and its permission list — so it is resolved before paint
	// rather than popped in afterwards.
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(googleHealthAccessQueryOptions()),
	component: DashboardPage,
});

function DashboardPage() {
	const router = useRouter();
	const { session, queryClient } = Route.useRouteContext();
	const search = Route.useSearch();
	const health = Route.useLoaderData();
	const [pending, setPending] = useState(false);

	// A failed link round trip lands here as a query param, so it has to be read
	// from the URL rather than from component state.
	const oauthError =
		search.error !== undefined
			? describeOAuthError(search.error, search.error_description)
			: null;

	async function onSignOut() {
		setPending(true);
		await authClient.signOut();

		// Signing out has to reach the identity provider too: without this, FedCM
		// keeps the account it auto-selected and the One Tap prompt waiting on
		// `/login` can hand the session straight back.
		await preventSilentAccess();

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

			<GoogleHealthAuthorization
				access={health}
				loginHint={session.user.email}
				callbackURL={HEALTH_CALLBACK_URL}
				errorCallbackURL={HEALTH_ERROR_CALLBACK_URL}
				error={oauthError}
				justAuthorized={search.health === "granted"}
			/>

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
