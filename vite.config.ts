import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * How long a Vercel function may run, in seconds.
 *
 * Only the sync endpoint needs more than a moment, but Nitro deploys the whole
 * app as one function — the generated output routes `/(.*)` to a single
 * `__server` — so this is the app-wide ceiling rather than a per-route setting.
 * A ceiling costs nothing on its own; Vercel bills actual duration.
 *
 * 60 is the Pro tier's default maximum and needs no extra configuration. Raising
 * it (Pro allows up to 300) means raising `HEALTH_SYNC_BUDGET_MS` with it, and
 * the budget must stay below this number or the platform kills the run while it
 * is writing its own bookkeeping.
 */
const VERCEL_MAX_DURATION_SECONDS = 60;

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		devtools(),
		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			vercel: {
				/**
				 * Written straight into `.vercel/output/config.json`.
				 *
				 * This is the only place a cron can be declared that a Build Output
				 * API deployment is guaranteed to read. Nitro emits that file itself
				 * and does not merge the repository's `vercel.json` into it, so a
				 * `crons` block there would be a schedule that looks configured and
				 * may never fire — which is the worst possible failure for a job
				 * nobody watches. Verified by inspecting the generated config.
				 *
				 * Every ten minutes because this deployment is on Vercel Pro. The
				 * daily work only needs one run a day, but the backfill advances one
				 * chunk per user per invocation, so the interval is what decides
				 * whether years of history take days or months. Runs that find
				 * nothing owed cost one `idle` row each.
				 */
				config: {
					crons: [{ path: "/api/cron/sync", schedule: "*/10 * * * *" }],
					version: 3,
				},
				functions: { maxDuration: VERCEL_MAX_DURATION_SECONDS },
			},
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
