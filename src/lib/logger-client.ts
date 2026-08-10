/**
 * Minimal scoped logger for browser code.
 *
 * Deliberately a sibling of `logger.server.ts` rather than a shared module: the
 * two differ only in where the level comes from, and that difference is the
 * whole point. `logger.server.ts` reads `LOG_LEVEL` from `process.env`, which
 * the browser cannot see, so this one falls back to the build mode and lets a
 * developer raise verbosity at runtime:
 *
 *   localStorage.setItem('app:logLevel', 'debug')   // then reload
 *
 * That escape hatch matters for anything involving Google Identity Services:
 * the prompt is frequently suppressed by the browser for reasons only visible
 * in these logs, and shipping a build just to see them is not an option.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
}

/** localStorage key that overrides the level for the current browser only. */
export const LOG_LEVEL_STORAGE_KEY = "app:logLevel";

const CONSOLE_METHOD: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
	debug: "debug",
	info: "info",
	warn: "warn",
	error: "error",
};

function readOverride(): LogLevel | undefined {
	if (typeof window === "undefined") return undefined;

	let raw: string | null;
	try {
		raw = window.localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
	} catch {
		// Storage access throws outright when cookies/site data are blocked;
		// losing the override is not worth taking the page down with it.
		return undefined;
	}

	const value = raw?.trim().toLowerCase();
	if (
		value !== undefined &&
		(LOG_LEVELS as readonly string[]).includes(value)
	) {
		return value as LogLevel;
	}
	return undefined;
}

/**
 * Active level: the localStorage override if set, otherwise `debug` in a dev
 * build and `warn` in production — one step louder than the server's `error`,
 * because a suppressed One Tap prompt is a warning nobody else reports.
 */
export function getLogLevel(): LogLevel {
	return readOverride() ?? (import.meta.env.DEV ? "debug" : "warn");
}

export function isLevelEnabled(level: LogLevel): boolean {
	return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(getLogLevel());
}

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
