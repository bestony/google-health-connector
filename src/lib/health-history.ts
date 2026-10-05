/**
 * How far back a health read may reach, in days.
 *
 * Every read is live: the MCP tools ask Google at the moment a client calls
 * them, and this server keeps no copy. The window bounds how much one read can
 * ask Google for, and the landing page and the Terms quote it, so it lives here
 * rather than in any one of them.
 *
 * This module is pure data. Keep it free of imports so both the browser bundle
 * and the server can use it.
 */
export const HISTORY_LIMIT_DAYS = 90;
