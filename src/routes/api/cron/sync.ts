import { createFileRoute } from "@tanstack/react-router";
import { handleSyncRequest } from "../../../lib/health-sync/handler.server";

/**
 * The scheduler's entry point: one time-budgeted slice of the health sync.
 *
 * GET and POST do the same thing. GET exists because Vercel Cron issues one and
 * attaches `Authorization: Bearer $CRON_SECRET` by itself; POST because every
 * other scheduler — a systemd timer, a Compose sidecar, a person with `curl` —
 * reaches for it. Both require that header, and both answer 404 while
 * `HEALTH_SYNC_ENABLED` is not `true`.
 *
 * Add `?dryRun=1` to see the plan without taking the lease or writing anything.
 *
 * The handler never runs longer than `HEALTH_SYNC_BUDGET_MS`, holds a database
 * lease for the duration, and reports `moreWork` when the budget ran out before
 * the debt did. Calling it again immediately is always safe: the work a run
 * owes is derived from sync state, not from a queue, so there is nothing to
 * double-process.
 *
 * This is a server route, matched before the SSR handler, so the `Accept`
 * sniffing in `src/server.ts` never sees it — the same reason `/mcp` is
 * unaffected.
 */
export const Route = createFileRoute("/api/cron/sync")({
	server: {
		handlers: {
			GET: ({ request }) => handleSyncRequest(request),
			POST: ({ request }) => handleSyncRequest(request),
		},
	},
});
