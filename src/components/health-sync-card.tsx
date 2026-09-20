import { useState } from "react";
import {
	type HealthSyncPreference,
	purgeHealthSyncCache,
	retryBlockedHealthDataTypes,
	setHealthSyncEnabled,
} from "../lib/health-sync-preference";

/**
 * The health data cache card on the dashboard.
 *
 * This card is a consent surface, not a settings toggle. Everywhere else the
 * app promises to read health data live and keep no copy; turning this on is
 * the one thing that changes that, so the card says plainly what will be
 * stored, for how long, and that switching off deletes it — in the same words
 * the privacy policy uses.
 *
 * Turning it off is destructive and therefore asks first, like the API key
 * card's revoke. The confirmation is not about the click being hard to undo —
 * re-enabling takes one click — but about what re-enabling costs: the history
 * is gone and has to be fetched again, which takes days on a platform that
 * allows one scheduled run per day.
 */

interface HealthSyncCardProps {
	preference: HealthSyncPreference;
	/** Refetches `preference` after this card changes it. */
	onChanged: () => Promise<void>;
}

type Pending = "enable" | "disable" | "purge" | "retry" | null;

const NUMBER_FORMAT = new Intl.NumberFormat();

function formatDate(value: string | null): string {
	if (value === null) return "—";
	return new Date(value).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function HealthSyncCard({ preference, onChanged }: HealthSyncCardProps) {
	const [pending, setPending] = useState<Pending>(null);
	const [confirmingDisable, setConfirmingDisable] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const busy = pending !== null;

	async function run(
		action: Exclude<Pending, null>,
		task: () => Promise<unknown>,
	) {
		setError(null);
		setConfirmingDisable(false);
		setPending(action);
		try {
			await task();
			await onChanged();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not change the health data cache.",
			);
		} finally {
			setPending(null);
		}
	}

	if (preference.status === "unavailable") {
		return (
			<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
				<h2 className="text-lg font-semibold">Health history</h2>
				<p className="mt-2 max-w-prose text-sm text-muted-foreground">
					This deployment does not run the background sync, so your health data
					is only ever read live from Google when you or a connected client asks
					for it. Nothing is stored.
				</p>
			</section>
		);
	}

	return (
		<section className="rounded-lg border border-border bg-card p-6 shadow-xs">
			<header className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="text-lg font-semibold">Health history</h2>
				<span
					className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
						preference.enabled
							? "bg-primary/10 text-primary"
							: "bg-secondary text-secondary-foreground"
					}`}
				>
					{preference.enabled ? "Storing" : "Not storing"}
				</span>
			</header>

			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				By default we read your health data live from Google and keep no copy.
				Turn this on and we will also fetch the categories you authorized once a
				day and store them here, which is what makes questions about last year —
				trends, comparisons, year-over-year — answerable at all.
			</p>
			<p className="mt-2 max-w-prose text-sm text-muted-foreground">
				We store only what you already authorized. Turning this off deletes
				everything we kept, straight away, and so does deleting your account or
				revoking our access at Google.
			</p>

			{preference.enabled && (
				<dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
					<Fact
						label="Stored points"
						value={NUMBER_FORMAT.format(preference.pointCount)}
					/>
					<Fact label="Oldest" value={formatDate(preference.coveredFrom)} />
					<Fact label="Newest" value={formatDate(preference.coveredThrough)} />
					<Fact label="Last sync" value={formatDate(preference.lastSyncAt)} />
				</dl>
			)}

			{preference.enabled && preference.lastSyncAt === null && (
				<p className="mt-3 max-w-prose text-sm text-muted-foreground">
					Nothing has been fetched yet. The first sync runs on this deployment's
					schedule; the first one is the slow one, because it works out which
					categories Google will let us read.
				</p>
			)}

			{preference.blockedDataTypes.length > 0 && (
				<div className="mt-4 max-w-prose rounded-md border border-border bg-secondary/40 px-4 py-3">
					<p className="text-sm">
						Google refused {preference.blockedDataTypes.length} data{" "}
						{preference.blockedDataTypes.length === 1 ? "type" : "types"},
						usually because its consent category was left unticked. They are
						retried automatically each week.
					</p>
					<button
						className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
						disabled={busy}
						type="button"
						onClick={() => run("retry", () => retryBlockedHealthDataTypes())}
					>
						{pending === "retry" ? "Retrying…" : "Retry them now"}
					</button>
				</div>
			)}

			<div className="mt-5 flex flex-wrap gap-2">
				<CardActions
					busy={busy}
					confirmingDisable={confirmingDisable}
					enabled={preference.enabled}
					pending={pending}
					pointCount={preference.pointCount}
					onConfirmingDisable={setConfirmingDisable}
					onRun={run}
				/>
			</div>

			{confirmingDisable && (
				<p className="mt-3 max-w-prose text-sm text-muted-foreground">
					Everything cached is deleted immediately. You can turn this back on
					whenever you like, but the history has to be fetched again from
					scratch, which takes days rather than minutes.
				</p>
			)}

			{error && <p className="mt-3 text-sm text-destructive">{error}</p>}
		</section>
	);
}

interface CardActionsProps {
	enabled: boolean;
	confirmingDisable: boolean;
	busy: boolean;
	pending: Pending;
	pointCount: number;
	onConfirmingDisable: (confirming: boolean) => void;
	onRun: (
		action: Exclude<Pending, null>,
		task: () => Promise<unknown>,
	) => Promise<void>;
}

const OUTLINE_BUTTON =
	"rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50";

/**
 * The three states the buttons can be in, as a component rather than nested
 * ternaries: off, on, and on-with-a-confirmation-pending.
 */
function CardActions(props: CardActionsProps) {
	const { busy, onConfirmingDisable, onRun, pending } = props;

	if (!props.enabled) {
		return (
			<button
				className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
				disabled={busy}
				type="button"
				onClick={() =>
					onRun("enable", () => setHealthSyncEnabled({ data: true }))
				}
			>
				{pending === "enable" ? "Turning on…" : "Store my health history"}
			</button>
		);
	}

	if (props.confirmingDisable) {
		return (
			<>
				<button
					className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
					disabled={busy}
					type="button"
					onClick={() =>
						onRun("disable", () => setHealthSyncEnabled({ data: false }))
					}
				>
					{pending === "disable" ? "Deleting…" : "Yes, stop and delete"}
				</button>
				<button
					className={OUTLINE_BUTTON}
					disabled={busy}
					type="button"
					onClick={() => onConfirmingDisable(false)}
				>
					Keep storing
				</button>
			</>
		);
	}

	return (
		<>
			<button
				className={OUTLINE_BUTTON}
				disabled={busy}
				type="button"
				onClick={() => onConfirmingDisable(true)}
			>
				Stop storing and delete
			</button>
			<button
				className={OUTLINE_BUTTON}
				disabled={busy || props.pointCount === 0}
				type="button"
				onClick={() => onRun("purge", () => purgeHealthSyncCache())}
			>
				{pending === "purge" ? "Deleting…" : "Delete what is stored"}
			</button>
		</>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 font-medium">{value}</dd>
		</div>
	);
}
