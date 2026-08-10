import { useState } from "react";
import {
	type ApiKeyStatus,
	type ApiKeySummary,
	issueApiKey,
	revokeApiKey,
} from "../lib/api-key";
import { API_KEY_PREFIX } from "../lib/api-key-config";

/**
 * The API key card on the dashboard.
 *
 * One key per account, which is what makes this a card and not a table: there
 * is a single credential, it is either there or it is not, and the only actions
 * are create, replace and revoke.
 *
 * The plaintext key is shown exactly once, in the reply to the call that made
 * it — the server keeps only a hash. That is the whole reason the "copy it now"
 * panel exists and why it says so in as many words: a user who closes the page
 * without copying has to regenerate, and regenerating breaks whatever they had
 * already connected.
 *
 * Both destructive actions ask first. Not because a misclick is catastrophic —
 * a new key is one more click — but because the damage lands somewhere else, on
 * an MCP client that quietly stops working until someone notices.
 */

interface ApiKeyCardProps {
	/** What the server knows about this user's key. */
	status: ApiKeyStatus;
	/** Absolute URL of this deployment's MCP endpoint, for the snippet. */
	mcpUrl: string;
	/** Refetches `status` after this card changes it. */
	onChanged: () => Promise<void>;
}

/** Which destructive action is waiting for a second click. */
type Pending = "issue" | "regenerate" | "revoke" | null;

export function ApiKeyCard({ status, mcpUrl, onChanged }: ApiKeyCardProps) {
	/** The plaintext key, for as long as this page stays open. */
	const [issued, setIssued] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<Exclude<Pending, "issue">>(null);
	const [pending, setPending] = useState<Pending>(null);
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const busy = pending !== null;
	const active = status.status === "active";

	async function onIssue(action: "issue" | "regenerate") {
		setError(null);
		setConfirming(null);
		setPending(action);

		try {
			const result = await issueApiKey();
			setIssued(result.key);
			setCopied(false);
			await onChanged();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not create the key.",
			);
		} finally {
			setPending(null);
		}
	}

	async function onRevoke() {
		setError(null);
		setConfirming(null);
		setPending("revoke");

		try {
			await revokeApiKey();
			// Drop the plaintext along with the key it belongs to: leaving it on
			// screen would invite copying a credential that no longer works.
			setIssued(null);
			await onChanged();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not revoke the key.",
			);
		} finally {
			setPending(null);
		}
	}

	async function onCopy(value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			// Clipboard access is refused in some contexts (no HTTPS, no user
			// gesture the browser recognises). The key is on screen and selectable,
			// so say what happened instead of failing silently.
			setError("Could not reach the clipboard. Select the key and copy it.");
		}
	}

	return (
		<section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-xs">
			<header className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-lg font-semibold">API key</h2>
				<StatusBadge status={status} />
			</header>

			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				One key per account. It is what an MCP client sends to prove a request
				is yours — anyone holding it can call your tools as you, so treat it
				like a password and paste it only into a client you run.
			</p>

			{status.status === "unavailable" && (
				<p className="mt-3 text-sm text-muted-foreground">
					Your key could not be read just now, so this card may be out of date.
					Reload before generating a new one — generating replaces whatever is
					already there.
				</p>
			)}

			{issued !== null && (
				<div className="mt-4 max-w-prose rounded-md border border-primary/40 bg-accent px-4 py-3">
					<p className="text-sm font-medium text-accent-foreground">
						Copy this now — it is not shown again.
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						{/* `select-all` so a click-drag or ⌘A grabs the whole key when the
						    clipboard is out of reach. */}
						<code className="min-w-0 flex-1 select-all break-all rounded border border-border bg-background px-3 py-2 font-mono text-xs">
							{issued}
						</code>
						<button
							className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
							type="button"
							onClick={() => onCopy(issued)}
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
					<p className="mt-2 text-xs text-accent-foreground">
						We store only a hash of it. If you lose it, generate a new one and
						update every client that used the old one.
					</p>
				</div>
			)}

			{active && <KeyDetails summary={status.key} />}

			<div className="mt-5 flex flex-wrap items-center gap-3">
				{active ? (
					<>
						<button
							className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
							type="button"
							onClick={() => setConfirming("regenerate")}
							disabled={busy || confirming !== null}
						>
							{pending === "regenerate" ? "Generating…" : "Regenerate"}
						</button>
						<button
							className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
							type="button"
							onClick={() => setConfirming("revoke")}
							disabled={busy || confirming !== null}
						>
							{pending === "revoke" ? "Revoking…" : "Revoke"}
						</button>
					</>
				) : (
					<button
						className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						type="button"
						onClick={() => onIssue("issue")}
						disabled={busy}
					>
						{pending === "issue" ? "Generating…" : "Generate API key"}
					</button>
				)}
			</div>

			{confirming !== null && (
				<div className="mt-3 max-w-prose rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
					<p className="text-sm">
						{confirming === "regenerate"
							? "Regenerating revokes the current key first. Every client using it stops working until you paste the new one in."
							: "Revoking deletes the key. Every client using it stops working, and you will need to generate a new one."}
					</p>
					<div className="mt-3 flex flex-wrap gap-3">
						<button
							className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
							type="button"
							onClick={() =>
								confirming === "regenerate" ? onIssue("regenerate") : onRevoke()
							}
						>
							{confirming === "regenerate" ? "Regenerate" : "Revoke"}
						</button>
						<button
							className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary"
							type="button"
							onClick={() => setConfirming(null)}
						>
							Cancel
						</button>
					</div>
				</div>
			)}

			{error && <p className="mt-3 text-sm text-destructive">{error}</p>}

			<ConnectSnippet mcpUrl={mcpUrl} />
		</section>
	);
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
	const label =
		status.status === "active"
			? "Active"
			: status.status === "unavailable"
				? "Status unknown"
				: "No key yet";

	return (
		<span
			className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
				status.status === "active"
					? "border-primary/40 bg-accent text-accent-foreground"
					: "border-border text-muted-foreground"
			}`}
		>
			{label}
		</span>
	);
}

/**
 * What is known about the key once it exists.
 *
 * Dates are cut out of the ISO string rather than run through
 * `toLocaleDateString()`: the server and the browser do not share a locale or a
 * timezone, and a value that renders differently in the two is a hydration
 * mismatch. A day is all this needs to convey.
 */
function KeyDetails({ summary }: { summary: ApiKeySummary }) {
	return (
		<dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
			<dt className="font-medium">Key</dt>
			<dd className="font-mono">
				{summary.start ?? API_KEY_PREFIX}
				<span className="text-muted-foreground">…</span>
			</dd>
			<dt className="font-medium">Created</dt>
			<dd>{summary.createdAt.slice(0, 10)}</dd>
			<dt className="font-medium">Last used</dt>
			<dd>{summary.lastRequest?.slice(0, 10) ?? "Never"}</dd>
		</dl>
	);
}

/**
 * How to point a client at this deployment.
 *
 * The endpoint URL comes from the server rather than from `window.location`, so
 * it is the origin the app is actually configured for — which is the one Google
 * and the OAuth redirect already have to agree on.
 */
function ConnectSnippet({ mcpUrl }: { mcpUrl: string }) {
	return (
		<details className="mt-5">
			<summary className="cursor-pointer text-sm font-medium">
				Connect an MCP client
			</summary>

			<p className="mt-3 max-w-prose text-sm text-muted-foreground">
				Point any MCP client at the endpoint below and send the key on every
				request. Without one a client can still connect and list the tools — it
				just cannot call them.
			</p>

			<pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
				{`claude mcp add --transport http ghealth ${mcpUrl} \\\n  --header "Authorization: Bearer YOUR_KEY"`}
			</pre>
		</details>
	);
}
