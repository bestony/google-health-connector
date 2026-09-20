import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Authenticating the scheduler.
 *
 * The cron endpoint is reachable from the internet and runs work on behalf of
 * every opted-in user, so it gets a real credential check rather than an
 * obscure path. The shape mirrors `mcp/credential.ts`: classify first, decide
 * second, and keep both testable.
 *
 * `.server.ts` because of `node:crypto`, but still under the coverage gate, the
 * same way `logger.server.ts` and `env.server.ts` are.
 */

const BEARER = /^Bearer[ ]+(.+)$/i;

/**
 * The bearer token on a request, or `undefined`.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when a
 * variable of exactly that name exists on the project, which is why the header
 * is the only accepted place for the secret. A query parameter would be simpler
 * for a hand-written `curl` and would also write the secret into every access
 * log between here and the caller.
 */
export function extractCronCredential(headers: Headers): string | undefined {
	const header = headers.get("authorization");
	if (header === null) return undefined;
	const match = BEARER.exec(header.trim());
	if (match === null) return undefined;
	const token = match[1]?.trim();
	return token === undefined || token === "" ? undefined : token;
}

/**
 * Constant-time comparison of two secrets.
 *
 * Both sides are hashed to a fixed width before comparing. `timingSafeEqual`
 * throws outright on a length mismatch, so comparing the raw strings would
 * force a branch on length — which leaks the secret's length — and an early
 * return that costs measurably less than a real comparison. Hashing first makes
 * every call do the same work whatever was presented.
 *
 * Comparing with `===` would leak the shared prefix one character at a time.
 */
export function secretsMatch(
	presented: string | undefined,
	expected: string | undefined,
): boolean {
	if (presented === undefined || expected === undefined) return false;
	if (presented === "" || expected === "") return false;

	const left = createHash("sha256").update(presented, "utf8").digest();
	const right = createHash("sha256").update(expected, "utf8").digest();
	return timingSafeEqual(left, right);
}
