import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

function isNamedFunction(
	value: unknown,
	name: string,
): value is (...args: unknown[]) => unknown {
	return typeof value === "function" && value.name === name;
}

async function loadInstalledStoreToken(): Promise<
	(...args: unknown[]) => unknown
> {
	const entryPath = require.resolve("@better-auth/oauth-provider");
	const distDirectory = dirname(entryPath);
	const utilityFiles = (await readdir(distDirectory)).filter((file) =>
		/^utils-.*\.mjs$/.test(file),
	);
	if (utilityFiles.length !== 1) {
		throw new Error(
			`Expected one installed OAuth provider utility bundle, found ${utilityFiles.length}`,
		);
	}

	const utilityModule: unknown = await import(
		pathToFileURL(join(distDirectory, utilityFiles[0] ?? "")).href
	);
	if (typeof utilityModule !== "object" || utilityModule === null) {
		throw new Error("OAuth provider utility bundle did not export an object");
	}

	const storeToken = Object.values(utilityModule).find((value) =>
		isNamedFunction(value, "storeToken"),
	);
	if (storeToken === undefined) {
		throw new Error("Installed OAuth provider did not export storeToken");
	}
	return storeToken;
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("MCP OAuth token storage", () => {
	it("pins hashed storage to a 43-character database representation", async () => {
		vi.stubEnv("DATABASE_URL", ":memory:");
		vi.stubEnv(
			"BETTER_AUTH_SECRET",
			"test-secret-at-least-thirty-two-characters",
		);
		vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
		vi.stubEnv("MCP_OAUTH_ENABLED", "true");
		vi.stubEnv("LOG_LEVEL", "error");

		const { getAuth } = await import("./auth.server");
		const oauthPlugin = getAuth().options.plugins?.find(
			(plugin) => plugin.id === "oauth-provider",
		);
		expect(oauthPlugin?.options).toMatchObject({ storeTokens: "hashed" });

		const storeToken = await loadInstalledStoreToken();
		const digests: unknown[] = await Promise.all(
			[
				["opaque-access-token", "access_token"],
				["refresh-token", "refresh_token"],
			].map(([token, type]) => storeToken("hashed", token, type)),
		);
		for (const digest of digests) {
			expect(digest).toBeTypeOf("string");
			expect(digest).toHaveLength(43);
			expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
		}
	});
});
