import { defineConfig, devices } from "@playwright/test";

const localBaseUrl = "http://127.0.0.1:3000";

// This configuration is the environment boundary for local and deployed tests.
const { CI, E2E_BASE_URL } = process.env;
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
				command: "pnpm dev --host 127.0.0.1",
				url: localBaseUrl,
				reuseExistingServer: !isCi,
				timeout: 120_000,
			}
		: undefined,
});
