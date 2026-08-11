import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ApiKeyCard } from "../components/api-key-card";
import { ConnectedAppsCard } from "../components/connected-apps-card";
import { GoogleHealthAuthorization } from "../components/google-health-authorization";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../components/ui/tabs";
import { API_KEY_QUERY_KEY, apiKeyQueryOptions } from "../lib/api-key";
import { authClient } from "../lib/auth-client";
import {
	describeOAuthError,
	sanitizeOAuthErrorParam,
} from "../lib/auth-errors";
import { googleHealthAccessQueryOptions } from "../lib/google-health-access";
import { hasAllGoogleHealthScopes } from "../lib/google-health-scopes";
import { mcpEndpointQueryOptions } from "../lib/mcp/endpoint";
import {
	OAUTH_GRANTS_QUERY_KEY,
	oauthGrantsQueryOptions,
} from "../lib/oauth-grants";
import { preventSilentAccess } from "../lib/one-tap-client";

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
	// Each card's whole shape — badge, button label, contents — follows from
	// what the server already knows, so all of it is resolved before paint
	// rather than popped in afterwards. The four are independent, so they are
	// fetched together instead of in sequence.
	loader: async ({ context }) => {
		const [health, apiKey, oauthGrants, mcpConnection] = await Promise.all([
			context.queryClient.ensureQueryData(googleHealthAccessQueryOptions()),
			context.queryClient.ensureQueryData(apiKeyQueryOptions()),
			context.queryClient.ensureQueryData(oauthGrantsQueryOptions()),
			context.queryClient.ensureQueryData(mcpEndpointQueryOptions()),
		]);
		return { health, apiKey, oauthGrants, mcpConnection };
	},
	component: DashboardPage,
});

function DashboardPage() {
	const router = useRouter();
	const { session, queryClient } = Route.useRouteContext();
	const search = Route.useSearch();
	const { health, apiKey, oauthGrants, mcpConnection } = Route.useLoaderData();
	const [pending, setPending] = useState(false);

	// A failed link round trip lands here as a query param, so it has to be read
	// from the URL rather than from component state.
	const oauthError =
		search.error !== undefined
			? describeOAuthError(search.error, search.error_description)
			: null;

	// Which tab opens follows from where the user is in the setup: until every
	// permission is granted the work to do is on the Google Health tab, and once
	// it all is, the manual connection controls are on the API key tab. OAuth
	// clients enter through the authorization flow and land on `/consent`, not on
	// this dashboard. Two arrivals win over the default: an OAuth error renders
	// inside the Google Health card, and hiding it would read as a silent success;
	// a completed Google grant opens on its confirmation and actual scope report.
	const justAuthorized = search.health === "granted";
	const allGranted =
		health.status === "linked" &&
		hasAllGoogleHealthScopes(health.grantedScopes);
	const defaultTab =
		oauthError === null && allGranted && !justAuthorized
			? "api-key"
			: "google-health";

	/**
	 * Re-read the key after the card has created or revoked one.
	 *
	 * The entry is removed rather than invalidated. Invalidation marks a query
	 * stale and refetches the ones something is observing — and nothing observes
	 * this one, because the loader reads it through `ensureQueryData`, which
	 * hands back whatever is cached without caring that it went stale a moment
	 * ago. Removing it leaves nothing to hand back, so the re-run loader has to
	 * ask the server, and the card stops describing the key it just replaced.
	 */
	async function onApiKeyChanged() {
		queryClient.removeQueries({ queryKey: API_KEY_QUERY_KEY });
		await router.invalidate();
	}

	async function onOAuthGrantsChanged() {
		queryClient.removeQueries({ queryKey: OAUTH_GRANTS_QUERY_KEY });
		await router.invalidate();
	}

	async function onSignOut() {
		setPending(true);
		await authClient.signOut();

		// Signing out has to reach the identity provider too: without this, FedCM
		// keeps the account it auto-selected and the One Tap prompt waiting on
		// `/login` can hand the session straight back.
		await preventSilentAccess();

		// The whole cache, not just the session. Every entry in it was fetched as
		// the user who is leaving — their key, their Google grants — and the next
		// person to sign in on this tab does so without a page load, so anything
		// left behind would be read back as theirs.
		//
		// Cleared rather than invalidated, too: nothing observes these queries,
		// and invalidation only refetches what is observed. The loaders read them
		// through `ensureQueryData`, which returns whatever is cached without
		// caring that it went stale.
		queryClient.clear();
		await router.invalidate();
		await router.navigate({ to: "/login", search: { redirect: undefined } });
	}

	return (
		<div className="p-8">
			<h1 className="text-2xl font-bold">Dashboard</h1>

			{/* Only what identifies the account to its owner. The user id, the
			    verification flag and the session expiry were debugging output from
			    the auth scaffold: they tell the person reading them nothing they can
			    act on, and the id is a value worth not putting on screen at all. */}
			<dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
				<dt className="font-medium">Name</dt>
				<dd>{session.user.name}</dd>
				<dt className="font-medium">Email</dt>
				<dd>{session.user.email}</dd>
			</dl>

			<Tabs className="mt-8" defaultValue={defaultTab}>
				<TabsList>
					<TabsTrigger value="google-health">Google Health</TabsTrigger>
					<TabsTrigger value="api-key">API key</TabsTrigger>
					<TabsTrigger value="connected-apps">Connected apps</TabsTrigger>
				</TabsList>
				{/* All panels are kept mounted: Base UI unmounts a hidden panel by
				    default, and the cards hold state that must survive a tab switch —
				    above all ApiKeyCard's plaintext key, which is shown exactly once
				    from local state and is unrecoverable once the card unmounts. A
				    hidden panel is rendered `hidden` and `inert`, so keeping it costs
				    nothing. */}
				<TabsContent keepMounted value="google-health">
					<GoogleHealthAuthorization
						access={health}
						loginHint={session.user.email}
						callbackURL={HEALTH_CALLBACK_URL}
						errorCallbackURL={HEALTH_ERROR_CALLBACK_URL}
						error={oauthError}
						justAuthorized={justAuthorized}
					/>
				</TabsContent>
				<TabsContent keepMounted value="api-key">
					<ApiKeyCard
						status={apiKey}
						mcpConnection={mcpConnection}
						onChanged={onApiKeyChanged}
					/>
				</TabsContent>
				<TabsContent keepMounted value="connected-apps">
					<ConnectedAppsCard
						status={oauthGrants}
						onChanged={onOAuthGrantsChanged}
					/>
				</TabsContent>
			</Tabs>

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
