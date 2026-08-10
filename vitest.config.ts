import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"#": new URL("./src", import.meta.url).pathname,
			"@": new URL("./src", import.meta.url).pathname,
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		coverage: {
			provider: "v8",
			reporter: ["text", "text-summary", "json", "html"],
			include: ["src/lib/**/*.ts", "src/db/dialect.ts"],
			// Generated Google schema code and server adapters are validated by
			// integration/build checks. The unit-test gate covers hand-written,
			// deterministic domain and transport-boundary helpers.
			exclude: [
				"src/lib/**/*.gen.ts",
				"src/lib/auth.server.ts",
				"src/lib/auth-client.ts",
				"src/lib/google-health-api.server.ts",
				"src/lib/google-health-token.server.ts",
				"src/lib/api-key.ts",
				"src/lib/google-health-access.ts",
				"src/lib/auth-providers.ts",
				"src/lib/session.ts",
				"src/lib/mcp/endpoint.ts",
				"src/lib/mcp/auth.server.ts",
				"src/lib/mcp/handler.server.ts",
				"src/lib/logger-client.ts",
				"src/lib/one-tap-client.ts",
			],
			thresholds: {
				lines: 95,
				functions: 95,
				branches: 95,
				statements: 95,
			},
		},
	},
});
