import { rmSync } from "node:fs";
import { runDirectory } from "./profiles";

export default function globalTeardown(): void {
	// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
	const keepDatabase = process.env.E2E_KEEP_DB === "1";
	// biome-ignore lint/style/noProcessEnv: Playwright configuration is the explicit environment boundary.
	const remoteRun = process.env.E2E_BASE_URL !== undefined;
	if (keepDatabase || remoteRun) {
		return;
	}
	rmSync(runDirectory, { recursive: true, force: true });
}
