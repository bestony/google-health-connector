/**
 * Hello-world domain logic exposed through the MCP server.
 *
 * Deliberately free of MCP and HTTP types: the transport layer decides how to
 * shape a protocol response, this module only answers "what should the greeting
 * say". Keeping the split means the logic stays unit-testable without standing
 * up a server, and new tools can follow the same shape — a plain function here,
 * a thin registration in `server.ts`.
 */

/** Used when the caller omits `name`, so the greeting never reads `Hello, undefined!`. */
const DEFAULT_NAME = "World";

/**
 * Build the greeting for `name`.
 *
 * Whitespace-only input is treated as absent rather than echoed back, because
 * an LLM filling the argument optimistically tends to send `""` instead of
 * omitting the field.
 */
export function buildGreeting(name?: string): string {
	const trimmed = name?.trim();
	return `Hello, ${trimmed ? trimmed : DEFAULT_NAME}!`;
}
