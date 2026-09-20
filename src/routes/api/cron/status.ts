import { createFileRoute } from "@tanstack/react-router";
import { handleStatusRequest } from "../../../lib/health-sync/handler.server";

/**
 * The run log: what the last twenty sync invocations did.
 *
 * This is the answer to "did last night's sync run, and what did it do?", and
 * it is a route rather than a log query because production defaults
 * `LOG_LEVEL` to `error` and a serverless platform's log retention is short.
 * One authenticated `curl` works identically on Vercel and on a VPS.
 *
 * Same credential and same kill switch as `./sync.ts`.
 */
export const Route = createFileRoute("/api/cron/status")({
	server: {
		handlers: {
			GET: ({ request }) => handleStatusRequest(request),
		},
	},
});
