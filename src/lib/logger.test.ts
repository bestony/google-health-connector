import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, getLogLevel, isLevelEnabled } from "./logger";

beforeEach(() => {
	vi.stubEnv("LOG_LEVEL", undefined);
	vi.stubEnv("NODE_ENV", undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("isomorphic logger", () => {
	it("uses the development default and emits every level", () => {
		vi.stubEnv("NODE_ENV", "development");
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger("test");

		expect(getLogLevel()).toBe("debug");
		expect(isLevelEnabled("debug")).toBe(true);
		log.debug("debug");
		log.info("info", { id: "1" });
		log.warn("warn");
		log.error("error", { safe: true });

		expect(debug).toHaveBeenCalledWith("[test]", "debug");
		expect(info).toHaveBeenCalledWith("[test]", "info", { id: "1" });
		expect(warn).toHaveBeenCalledWith("[test]", "warn");
		expect(error).toHaveBeenCalledWith("[test]", "error", { safe: true });
	});

	it("honors a configured level and filters disabled messages", () => {
		vi.stubEnv("LOG_LEVEL", "warn");
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger("test");

		expect(getLogLevel()).toBe("warn");
		expect(isLevelEnabled("info")).toBe(false);
		log.debug("debug");
		log.info("info");
		log.warn("warn");
		log.error("error");

		expect(debug).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledOnce();
	});

	it("falls back to error in production for an invalid level", () => {
		vi.stubEnv("LOG_LEVEL", "invalid");
		vi.stubEnv("NODE_ENV", "production");
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = createLogger("test");

		expect(getLogLevel()).toBe("error");
		log.info("info");
		log.error("error");

		expect(info).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledOnce();
	});
});
