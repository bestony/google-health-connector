import { useState } from "react";
import type { OAuthGrantSummary } from "../lib/oauth-grant-summary";
import { type OAuthGrantsStatus, revokeOAuthGrant } from "../lib/oauth-grants";

interface ConnectedAppsCardProps {
	status: OAuthGrantsStatus;
	onChanged: () => Promise<void>;
}

/** OAuth grants the signed-in user can inspect and revoke. */
export function ConnectedAppsCard({
	status,
	onChanged,
}: ConnectedAppsCardProps) {
	const [confirming, setConfirming] = useState<string | null>(null);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function onRevoke(grant: OAuthGrantSummary) {
		setError(null);
		setConfirming(null);
		setPending(grant.id);
		let revoked = false;

		try {
			await revokeOAuthGrant({ data: { consentId: grant.id } });
			revoked = true;
			await onChanged();
		} catch (cause) {
			let message = "Could not revoke this application.";
			if (revoked) {
				message =
					"Access was revoked, but this list could not refresh. Reload the page.";
			} else if (cause instanceof Error) {
				message = cause.message;
			}
			setError(message);
		} finally {
			setPending(null);
		}
	}

	return (
		<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
			<header className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-lg font-semibold">Connected apps</h2>
				{status.status === "ready" && status.grants.length > 0 && (
					<span className="rounded-full border border-primary/40 bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
						{status.grants.length} approved
					</span>
				)}
			</header>

			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				Applications listed here can use the OAuth scopes you approved. Revoking
				an approval also deletes that application's stored access and refresh
				tokens.
			</p>

			{status.status === "unavailable" && (
				<p className="mt-4 text-sm text-muted-foreground">
					Your connected applications could not be read just now. Reload before
					trying to change an approval.
				</p>
			)}
			{status.status === "ready" && (
				<ConnectedAppList
					grants={status.grants}
					confirming={confirming}
					pending={pending}
					onConfirm={setConfirming}
					onRevoke={onRevoke}
				/>
			)}

			{error && <p className="mt-4 text-sm text-destructive">{error}</p>}
		</section>
	);
}

function ConnectedAppList({
	grants,
	confirming,
	pending,
	onConfirm,
	onRevoke,
}: {
	grants: readonly OAuthGrantSummary[];
	confirming: string | null;
	pending: string | null;
	onConfirm: (grantId: string | null) => void;
	onRevoke: (grant: OAuthGrantSummary) => Promise<void>;
}) {
	if (grants.length === 0) {
		return (
			<p className="mt-4 text-sm text-muted-foreground">
				No application has been approved. Approval happens in the application
				when it asks to connect; applications cannot be approved here.
			</p>
		);
	}

	return (
		<ul className="mt-5 flex flex-col gap-4">
			{grants.map((grant) => (
				<ConnectedApp
					key={grant.id}
					grant={grant}
					confirming={confirming === grant.id}
					pending={pending === grant.id}
					disabled={pending !== null || confirming !== null}
					onConfirm={() => onConfirm(grant.id)}
					onCancel={() => onConfirm(null)}
					onRevoke={() => onRevoke(grant)}
				/>
			))}
		</ul>
	);
}

function ConnectedApp({
	grant,
	confirming,
	pending,
	disabled,
	onConfirm,
	onCancel,
	onRevoke,
}: {
	grant: OAuthGrantSummary;
	confirming: boolean;
	pending: boolean;
	disabled: boolean;
	onConfirm: () => void;
	onCancel: () => void;
	onRevoke: () => void;
}) {
	return (
		<li className="rounded-md border border-border px-4 py-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="font-medium">{grant.clientName}</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Approved {grant.approvedAt.slice(0, 10)}
					</p>
				</div>
				<button
					className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
					type="button"
					onClick={onConfirm}
					disabled={disabled}
				>
					{pending ? "Revoking…" : "Revoke"}
				</button>
			</div>

			<div className="mt-4">
				<p className="text-sm font-medium">Registered redirect URI</p>
				{grant.redirectUris.length === 0 ? (
					<p className="mt-1 text-sm text-muted-foreground">
						No registered redirect URI is available.
					</p>
				) : (
					<ul className="mt-2 flex flex-col gap-2">
						{grant.redirectUris.map((redirectUri) => (
							<li key={redirectUri}>
								<code className="block overflow-x-auto rounded border border-border bg-muted px-3 py-2 text-xs">
									{redirectUri}
								</code>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="mt-4">
				<p className="text-sm font-medium">Approved access</p>
				{grant.scopes.length === 0 ? (
					<p className="mt-1 text-sm text-muted-foreground">
						No OAuth scopes were recorded for this approval.
					</p>
				) : (
					<ul className="mt-2 flex flex-col gap-2">
						{grant.scopes.map((scope) => (
							<li className="text-sm" key={scope.scope}>
								<span className="font-medium">{scope.label}</span>
								<span className="text-muted-foreground">
									{" "}
									— {scope.description}
								</span>
								<code className="mt-1 block text-xs text-muted-foreground">
									{scope.scope}
								</code>
							</li>
						))}
					</ul>
				)}
			</div>

			{confirming && (
				<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
					<p className="text-sm">
						Revoking deletes this approval and the application's stored access
						and refresh tokens. Its current access token stops working on the
						next MCP request.
					</p>
					<div className="mt-3 flex flex-wrap gap-3">
						<button
							className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
							type="button"
							onClick={onRevoke}
						>
							Revoke access
						</button>
						<button
							className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
							type="button"
							onClick={onCancel}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</li>
	);
}
