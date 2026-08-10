/**
 * Facts about this app's API keys that both the server and the browser need.
 *
 * The prefix is rendered in the dashboard (so the copy box can explain what the
 * user is looking at) and configured on the plugin (so issued keys carry it),
 * which is exactly the kind of pair that goes wrong when it is written twice.
 *
 * This module is pure data. Keep it free of imports so both the browser bundle
 * and the server can use it.
 */

/**
 * Leading marker on every issued key.
 *
 * A key that announces where it came from is a key a secret scanner — and a
 * human staring at a leaked log line — can recognise and revoke. The trailing
 * underscore is better-auth's own recommendation for making the boundary
 * legible.
 */
export const API_KEY_PREFIX = "ghc_";

/**
 * How often one key may be verified — 10000 queries per second.
 *
 * The plugin's own default is 10 requests per *day*, which a single agent
 * conversation exhausts — so this is set explicitly rather than inherited. The
 * ceiling is meant to stop a runaway tool-calling loop, not to ration normal
 * use.
 *
 * The window is expressed as one second rather than as an equivalent average
 * over a longer one (6000 per minute is also "100 QPS") because the plugin
 * resets a key's counter only once a full window has passed *since its last
 * request*: a wide window turns a burst into a cooldown of that same width,
 * while a one-second window caps the instantaneous rate and lets a client that
 * overruns it recover after a one-second pause.
 *
 * These values are copied onto each key row when it is issued, so changing them
 * only affects keys created afterwards. Existing keys keep the limit they were
 * born with until they are regenerated.
 */
export const API_KEY_RATE_LIMIT = {
	/** Length of the window, in milliseconds. */
	timeWindow: 1_000,
	/** Verifications allowed inside one window. */
	maxRequests: 10000,
} as const;

/**
 * Header an MCP client sends the key in.
 *
 * `Authorization: Bearer <key>` is what MCP clients offer out of the box, so it
 * is the documented one; `x-api-key` is accepted too because it is the header
 * better-auth's own plugin uses and the one `curl` examples reach for.
 */
export const API_KEY_HEADER = "x-api-key";
