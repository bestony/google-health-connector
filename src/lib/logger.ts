import { createIsomorphicFn } from "@tanstack/react-start";

/** Log levels, ordered from most verbose to least. */
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

function readClientOverride(): LogLevel | undefined {
	if (typeof window === "undefined") return undefined;

	let raw: string | null;
	try {
		raw = window.localStorage.getItem(LOG_LEVEL_STORAGE_KEY);
	} catch {
		// Storage access throws when cookies or site data are blocked. Losing the
		// override is safer than taking the page down with it.
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

function readClientLevel(): LogLevel {
	return readClientOverride() ?? (import.meta.env.DEV ? "debug" : "warn");
}

function readServerLevel(): LogLevel {
	const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
	if (raw !== undefined && (LOG_LEVELS as readonly string[]).includes(raw)) {
		return raw as LogLevel;
	}
	return process.env.NODE_ENV === "production" ? "error" : "debug";
}

/**
 * The implementation is selected by TanStack Start before bundling. The
 * client never receives the server environment reader, and the server never
 * needs browser storage to decide its log level.
 */
const readLevel = createIsomorphicFn()
	.server(readServerLevel)
	.client(readClientLevel);

export function getLogLevel(): LogLevel {
	return readLevel();
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
