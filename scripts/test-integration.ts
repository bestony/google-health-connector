import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface IntegrationStep {
	name: string;
	args: readonly string[];
}

const steps: readonly IntegrationStep[] = [
	{ name: "database_migration", args: ["db:migrate"] },
	{ name: "production_build", args: ["build"] },
	{ name: "browser_smoke_tests", args: ["test:e2e"] },
];

function writeEvent(
	level: "info" | "error",
	event: string,
	fields: Record<string, unknown>,
) {
	const entry = JSON.stringify({
		level,
		scope: "integration_test",
		event,
		...fields,
	});

	if (level === "error") {
		console.error(entry);
		return;
	}
	console.info(entry);
}

function runStep(
	step: IntegrationStep,
	environment: NodeJS.ProcessEnv,
): number {
	writeEvent("info", "step_started", { step: step.name });
	const result = spawnSync("pnpm", [...step.args], {
		cwd: process.cwd(),
		env: environment,
		stdio: "inherit",
	});

	if (result.error !== undefined) {
		writeEvent("error", "step_failed", {
			step: step.name,
			exitCode: 1,
			reason: result.error.message,
		});
		return 1;
	}

	const exitCode = result.status ?? 1;
	if (exitCode !== 0) {
		writeEvent("error", "step_failed", { step: step.name, exitCode });
		return exitCode;
	}

	writeEvent("info", "step_completed", { step: step.name });
	return 0;
}

function findAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate a local integration test port."));
				return;
			}

			server.close((error) => {
				if (error !== undefined) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

async function main(): Promise<number> {
	const testDirectory = mkdtempSync(
		join(tmpdir(), "google-health-connector-integration-"),
	);

	try {
		const localPort = await findAvailablePort();
		const localBaseUrl = `http://127.0.0.1:${localPort}`;
		// biome-ignore lint/style/noProcessEnv: The runner replaces sensitive or stateful process values with isolated test settings before spawning any command.
		const environment: NodeJS.ProcessEnv = { ...process.env };
		Object.assign(environment, {
			DATABASE_URL: `file:${join(testDirectory, "integration.db")}`,
			BETTER_AUTH_SECRET:
				"integration-test-secret-not-for-production-0123456789abcdef",
			BETTER_AUTH_URL: localBaseUrl,
			MCP_OAUTH_ENABLED: "false",
			GOOGLE_CLIENT_ID: "",
			GOOGLE_CLIENT_SECRET: "",
			E2E_LOCAL_PORT: String(localPort),
			CI: "true",
			NODE_ENV: "test",
			LOG_LEVEL: "error",
		});
		delete environment.E2E_BASE_URL;
		delete environment.TURSO_AUTH_TOKEN;

		for (const step of steps) {
			const exitCode = runStep(step, environment);
			if (exitCode !== 0) return exitCode;
		}
		return 0;
	} finally {
		rmSync(testDirectory, { recursive: true, force: true });
	}
}

main()
	.then((exitCode) => {
		process.exitCode = exitCode;
	})
	.catch((error: unknown) => {
		writeEvent("error", "runner_failed", {
			reason: error instanceof Error ? error.message : "unknown_error",
		});
		process.exitCode = 1;
	});
