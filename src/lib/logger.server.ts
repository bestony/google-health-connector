import { getLogLevel, isLevelEnabled, type LogLevel } from "./env.server";

/**
 * Minimal scoped logger for server-side code.
 *
 * Kept dependency-free on purpose so it can be swapped for a transport-backed
 * logger later without touching call sites. Level filtering is evaluated per
 * call (see `env.server.ts`), so `LOG_LEVEL` can be changed without a rebuild.
 */

export interface Logger {
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
}

const CONSOLE_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
};

function emit(
	scope: string,
	level: LogLevel,
	message: string,
	context?: Record<string, unknown>,
): void {
	if (!isLevelEnabled(level)) return;
	const prefix = `[${scope}]`;
	if (context === undefined) {
		console[CONSOLE_METHOD[level]](prefix, message);
		return;
	}
	console[CONSOLE_METHOD[level]](prefix, message, context);
}

export function createLogger(scope: string): Logger {
	return {
		debug: (message, context) => emit(scope, "debug", message, context),
		info: (message, context) => emit(scope, "info", message, context),
		warn: (message, context) => emit(scope, "warn", message, context),
		error: (message, context) => emit(scope, "error", message, context),
	};
}

export { getLogLevel };
