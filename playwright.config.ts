import { defineConfig, devices } from "@playwright/test";
import { profiles, runDirectory } from "./e2e/profiles";

// This configuration is the environment boundary for end-to-end tests. Every
// local server gets its own database and an origin that matches BETTER_AUTH_URL
// exactly; no developer .env value is allowed to decide the test profile.
const { CI, E2E_BASE_URL } = process.env;
const isCi = CI !== undefined;

const localProjects = [
	{
		name: "local-dev",
		use: {
			...devices["Desktop Chrome"],
			baseURL: profiles["local-dev"].baseURL,
		},
		grepInvert: /@oauth|@no-google|@production/,
	},
	{
		name: "local-oauth",
		use: {
			...devices["Desktop Chrome"],
			baseURL: profiles["local-oauth"].baseURL,
		},
		grep: /@oauth/,
	},
	{
		name: "local-nogoogle",
		use: {
			...devices["Desktop Chrome"],
			baseURL: profiles["local-nogoogle"].baseURL,
		},
		grep: /@no-google/,
	},
];

const projects =
	E2E_BASE_URL === undefined
		? localProjects
		: [
				{
					name: "production",
					use: { ...devices["Desktop Chrome"], baseURL: E2E_BASE_URL },
					grep: /@production/,
				},
			];

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: isCi,
	retries: isCi ? 2 : 0,
	workers: isCi ? 4 : undefined,
	reporter: isCi ? "line" : "list",
	globalTeardown: "./e2e/global-teardown.ts",
	expect: { timeout: 5_000 },
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects,
	webServer:
		E2E_BASE_URL === undefined
			? Object.values(profiles).map((profile) => ({
					command: `mkdir -p ${runDirectory} && pnpm db:migrate && pnpm exec vite dev --host 127.0.0.1 --port ${profile.port} --strictPort`,
					url: `${profile.baseURL}/`,
					env: profile.env,
					reuseExistingServer: false,
					timeout: 120_000,
				}))
			: undefined,
});
