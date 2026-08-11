import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { useState } from "react";
import { GoogleHealthDataDisclosure } from "../components/google-health-data-disclosure";
import { authClient } from "../lib/auth-client";
import {
	type ConsentScopeCopy,
	describeConsentScopes,
	GOOGLE_HEALTH_CONSENT_CATEGORIES,
	parseConsentRequest,
	requestsGoogleHealthData,
	validateConsentSearch,
} from "../lib/oauth-consent";

/**
 * User approval for a signed OAuth authorization request.
 *
 * This page does not trust its query. better-auth verifies the HMAC again when
 * consent is submitted; the UI only uses the query to preserve the handoff and
 * explain what the registered client requested.
 */

async function requestPublicOAuthClient(clientId: string, cookie?: string) {
	const result = await authClient.oauth2.publicClient(
		{ query: { client_id: clientId } },
		cookie === undefined ? undefined : { headers: { cookie } },
	);
	if (result.error) {
		throw new Error(
			result.error.message ?? "The OAuth client could not be loaded.",
		);
	}
	if (result.data === null) {
		throw new Error("The OAuth client could not be loaded.");
	}
	return result.data;
}

/** Forward the current cookie only during SSR; browsers send it themselves. */
const loadPublicOAuthClient = createIsomorphicFn()
	.server((clientId: string) =>
		requestPublicOAuthClient(clientId, getRequestHeader("cookie")),
	)
	.client((clientId: string) => requestPublicOAuthClient(clientId));

export const Route = createFileRoute("/consent")({
	validateSearch: validateConsentSearch,
	loaderDeps: ({ search }) => {
		const request = parseConsentRequest(search);
		return {
			clientId: request.status === "ready" ? request.clientId : null,
		};
	},
	beforeLoad: ({ context, location, search }) => {
		const request = parseConsentRequest(search);
		if (request.signed && !context.session) {
			// Preserve the authorization server's canonical query byte-for-byte. A
			// router `to` + `search` redirect would re-serialize it and break the HMAC.
			throw redirect({ href: `/login${location.searchStr}` });
		}
	},
	loader: async ({ deps }) => {
		if (deps.clientId === null) return null;
		return loadPublicOAuthClient(deps.clientId);
	},
	head: () => ({
		meta: [
			{ title: "Authorize an MCP client — Google Health Connector" },
			{
				name: "description",
				content:
					"Review and approve an MCP client's access to your Google Health data.",
			},
		],
	}),
	component: ConsentPage,
});

function ConsentPage() {
	const search = Route.useSearch();
	const client = Route.useLoaderData();
	const request = parseConsentRequest(search);

	if (request.status === "unsigned") {
		return (
			<ConsentState
				title="No authorization request"
				message="There is no authorization request to approve."
			/>
		);
	}
	if (request.status === "invalid") {
		return (
			<ConsentState
				title="Invalid authorization request"
				message="This authorization request has no client identifier, so it cannot be approved."
			/>
		);
	}
	if (client === null) {
		return (
			<ConsentState
				title="Client unavailable"
				message="The OAuth client could not be loaded. Return to the dashboard and try again."
			/>
		);
	}

	return <ConsentRequestPage client={client} request={request} />;
}

function ConsentState({ title, message }: { title: string; message: string }) {
	return (
		<main className="mx-auto w-full max-w-2xl px-6 py-12">
			<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
				<h1 className="text-2xl font-semibold">{title}</h1>
				<p className="mt-3 text-sm text-muted-foreground">{message}</p>
				<Link
					className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
					to="/dashboard"
				>
					Go to dashboard
				</Link>
			</section>
		</main>
	);
}

type ConsentClient = NonNullable<ReturnType<typeof Route.useLoaderData>>;
type ReadyConsentRequest = Extract<
	ReturnType<typeof parseConsentRequest>,
	{ status: "ready" }
>;

function ConsentRequestPage({
	client,
	request,
}: {
	client: ConsentClient;
	request: ReadyConsentRequest;
}) {
	const [pending, setPending] = useState<"approve" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const clientName = client.client_name?.trim() || "Unnamed OAuth client";
	const scopeCopy = describeConsentScopes(request.scopes);
	const showsHealthCategories = requestsGoogleHealthData(request.scopes);

	async function answerConsent(accept: boolean) {
		setError(null);
		setPending(accept ? "approve" : "deny");

		try {
			const result = await authClient.oauth2.consent({ accept });
			if (result.error) {
				setError(
					result.error.message ??
						"The authorization response could not be saved.",
				);
				setPending(null);
			}
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The authorization response could not be saved.",
			);
			setPending(null);
		}
	}

	return (
		<main className="mx-auto w-full max-w-3xl px-6 py-12">
			<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
				<p className="text-sm font-medium text-muted-foreground">
					MCP client authorization
				</p>
				<h1 className="mt-1 text-2xl font-semibold">Authorize {clientName}?</h1>
				<p className="mt-3 text-sm text-muted-foreground">
					The registered redirect URI is the client identity you can verify:
				</p>
				<code className="mt-2 block overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 text-xs">
					{request.redirectUri ?? "No redirect URI was provided."}
				</code>

				<RequestedAccess scopes={scopeCopy} />
				{showsHealthCategories && <GoogleHealthCategoryAccess />}

				<GoogleHealthDataDisclosure />

				<p className="mt-4 text-sm text-muted-foreground">
					After approval, revoke this client's access from Connected apps on
					your{" "}
					<Link className="underline underline-offset-2" to="/dashboard">
						dashboard
					</Link>
					.
				</p>

				{error && <p className="mt-4 text-sm text-destructive">{error}</p>}

				<ConsentDecisionButtons pending={pending} onAnswer={answerConsent} />
			</section>
		</main>
	);
}

function RequestedAccess({ scopes }: { scopes: readonly ConsentScopeCopy[] }) {
	return (
		<section className="mt-6">
			<h2 className="text-lg font-semibold">Requested access</h2>
			{scopes.length === 0 ? (
				<p className="mt-2 text-sm text-muted-foreground">
					This request does not list any OAuth scopes.
				</p>
			) : (
				<ul className="mt-3 flex flex-col gap-3">
					{scopes.map((scope) => (
						<li
							className="rounded-md border border-border px-4 py-3"
							key={scope.scope}
						>
							<p className="text-sm font-medium">{scope.label}</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{scope.description}
							</p>
							<code className="mt-1 block text-xs text-muted-foreground">
								{scope.scope}
							</code>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function GoogleHealthCategoryAccess() {
	return (
		<section className="mt-6">
			<h2 className="text-lg font-semibold">
				Google Health categories this client can read
			</h2>
			<p className="mt-2 text-sm text-muted-foreground">
				If you approve, MCP responses can contain data from every category
				listed below. That data leaves this server and goes to the client
				identified by the redirect URI above.
			</p>
			<ul className="mt-3 grid gap-3 sm:grid-cols-2">
				{GOOGLE_HEALTH_CONSENT_CATEGORIES.map((category) => (
					<li
						className="rounded-md border border-border px-4 py-3"
						key={category.id}
					>
						<p className="text-sm font-medium">{category.label}</p>
						<p className="mt-1 text-sm text-muted-foreground">
							{category.description}
						</p>
					</li>
				))}
			</ul>
		</section>
	);
}

function ConsentDecisionButtons({
	pending,
	onAnswer,
}: {
	pending: "approve" | "deny" | null;
	onAnswer: (accept: boolean) => Promise<void>;
}) {
	return (
		<div className="mt-6 flex flex-wrap justify-end gap-3">
			<button
				className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
				type="button"
				disabled={pending !== null}
				onClick={() => onAnswer(false)}
			>
				{pending === "deny" ? "Denying…" : "Deny"}
			</button>
			<button
				className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
				type="button"
				disabled={pending !== null}
				onClick={() => onAnswer(true)}
			>
				{pending === "approve" ? "Approving…" : "Approve"}
			</button>
		</div>
	);
}
