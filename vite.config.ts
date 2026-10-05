import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * How long a Vercel function may run, in seconds.
 *
 * An MCP aggregate can fan out to several sequential Google reads, so it may
 * need more than a moment. Nitro deploys the whole app as one function — the
 * generated output routes `/(.*)` to a single `__server` — so this is the
 * app-wide ceiling rather than a per-route setting. A ceiling costs nothing on
 * its own; Vercel bills actual duration.
 */
const VERCEL_MAX_DURATION_SECONDS = 60;

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		devtools(),
		nitro({
			rollupConfig: { external: [/^@sentry\//] },
			vercel: {
				functions: { maxDuration: VERCEL_MAX_DURATION_SECONDS },
			},
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;
