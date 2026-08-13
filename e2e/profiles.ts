import { tmpdir } from "node:os";
import { join } from "node:path";

export type LocalProfileName = "local-dev" | "local-oauth" | "local-nogoogle";
export type E2EProfileName = LocalProfileName | "production";

export interface E2EProfile {
	name: E2EProfileName;
	port: number | undefined;
	baseURL: string;
	databaseUrl: string | undefined;
	env: Record<string, string>;
	local: boolean;
}

const DEFAULT_BASE_PORT = 3200;
const TRAILING_SLASHES = /\/+$/;
// The config and web-server commands share this explicit directory. Callers
// that run suites concurrently can provide an isolated directory through
// E2E_RUN_DIR.
// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
const explicitRunDirectory = process.env.E2E_RUN_DIR;
const runDirectory =
	explicitRunDirectory === undefined
		? join(tmpdir(), "google-health-connector-e2e")
		: explicitRunDirectory;

function readPort(name: string, fallback: number): number {
	// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
	const raw = process.env[name] ?? String(fallback);
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`${name} must be an integer from 1 to 65535.`);
	}
	return port;
}

const basePort = readPort("E2E_BASE_PORT", DEFAULT_BASE_PORT);
const secret =
	// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
	process.env.E2E_AUTH_SECRET ??
	"e2e-run-secret-not-for-production-0123456789abcdef";

function localProfile(
	name: LocalProfileName,
	port: number,
	options: { google: boolean; oauth: boolean },
): E2EProfile {
	const databaseUrl = `file:${join(runDirectory, `${name}.db`)}`;
	const env: Record<string, string> = {
		BETTER_AUTH_SECRET: secret,
		BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
		DATABASE_URL: databaseUrl,
		LOG_LEVEL: "debug",
		MCP_OAUTH_ENABLED: options.oauth ? "true" : "false",
		GOOGLE_CLIENT_ID: options.google ? "e2e-placeholder-client-id" : "",
		GOOGLE_CLIENT_SECRET: options.google ? "e2e-placeholder-client-secret" : "",
	};

	return {
		name,
		port,
		baseURL: `http://127.0.0.1:${port}`,
		databaseUrl,
		env,
		local: true,
	};
}

export const profiles: Readonly<Record<LocalProfileName, E2EProfile>> = {
	"local-dev": localProfile("local-dev", basePort, {
		google: true,
		oauth: false,
	}),
	"local-oauth": localProfile("local-oauth", basePort + 1, {
		google: true,
		oauth: true,
	}),
	"local-nogoogle": localProfile("local-nogoogle", basePort + 2, {
		google: false,
		oauth: false,
	}),
};

export function productionProfile(): E2EProfile {
	// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
	const baseURL = process.env.E2E_BASE_URL;
	if (baseURL === undefined || baseURL.trim() === "") {
		throw new Error("E2E_BASE_URL is required for the production profile.");
	}
	return {
		name: "production",
		port: undefined,
		baseURL: baseURL.replace(TRAILING_SLASHES, ""),
		databaseUrl: undefined,
		env: {},
		local: false,
	};
}

export function profileForProject(projectName: string): E2EProfile {
	if (projectName === "production") return productionProfile();
	const profile = profiles[projectName as LocalProfileName];
	if (profile === undefined) {
		throw new Error(`Unknown E2E project: ${projectName}`);
	}
	return profile;
}

export { runDirectory };
