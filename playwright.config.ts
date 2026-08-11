import { defineConfig, devices } from "@playwright/test";

// This configuration is the environment boundary for local and deployed tests.
const { CI, E2E_BASE_URL, E2E_LOCAL_PORT } = process.env;
const localPort = Number(E2E_LOCAL_PORT ?? "3000");
if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
	throw new Error(`E2E_LOCAL_PORT must be an integer from 1 to 65535.`);
}
const localBaseUrl = `http://127.0.0.1:${localPort}`;
const baseURL = E2E_BASE_URL ?? localBaseUrl;
const isCi = CI !== undefined;
const useLocalServer = new URL(baseURL).origin === new URL(localBaseUrl).origin;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: isCi,
	retries: isCi ? 2 : 0,
	workers: isCi ? 1 : undefined,
	reporter: isCi ? "line" : "list",
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: useLocalServer
		? {
				command: `pnpm exec vite dev --host 127.0.0.1 --port ${localPort}`,
				url: localBaseUrl,
				reuseExistingServer: !isCi,
				timeout: 120_000,
			}
		: undefined,
});
