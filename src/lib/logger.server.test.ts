import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.server";

// The logger reads LOG_LEVEL/NODE_ENV through env.server.ts, whose
// `import "dotenv/config"` leaks a developer's real .env into process.env.
// Scrub them so each test starts from the documented defaults.
beforeEach(() => {
	vi.stubEnv("LOG_LEVEL", undefined);
	vi.stubEnv("NODE_ENV", undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("scoped server logger", () => {
	it("emits enabled levels with and without context", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("LOG_LEVEL", "debug");
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger("test");

		log.debug("debug");
		log.info("info", { id: "1" });
		log.warn("warn");
		log.error("error", { safe: true });

		expect(debug).toHaveBeenCalledWith("[test]", "debug");
		expect(info).toHaveBeenCalledWith("[test]", "info", { id: "1" });
		expect(warn).toHaveBeenCalledWith("[test]", "warn");
		expect(error).toHaveBeenCalledWith("[test]", "error", { safe: true });
	});

	it("filters verbose levels according to the active level", () => {
		vi.stubEnv("NODE_ENV", "production");
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger("test");

		log.debug("debug");
		log.info("info");
		log.warn("warn");
		log.error("error");

		expect(debug).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledOnce();
	});
});
