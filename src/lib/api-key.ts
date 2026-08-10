import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "./auth.server";
import { createLogger } from "./logger.server";

/**
 * The signed-in user's API key: what it looks like, and how it is issued and
 * revoked.
 *
 * One key per user. better-auth's plugin is happy to mint many, so the limit is
 * enforced here rather than by configuration — which is also why issuing goes
 * through this module instead of `authClient.apiKey.create` in the browser: a
 * client-side call would be a second, unconstrained way in.
 *
 * The plaintext key exists exactly once, in the reply to the call that created
 * it. Everything after that reads the stored row, which holds only a hash and
 * the leading characters. Nothing in here logs the key itself.
 *
 * Same isomorphic shape as `session.ts` and `google-health-access.ts`: TanStack
 * Start strips the `.handler()` body (and the `auth.server` import with it) from
 * the client bundle, so route files and components can import this freely.
 */

const log = createLogger("api-key");

/**
 * Recorded as the key's name.
 *
 * With one key per user there is nothing to tell apart, so this describes what
 * the key is *for* — which is what a user reading it in a list wants to know.
 */
const API_KEY_NAME = "MCP access";

/** What the dashboard can show about a key. Never includes the key itself. */
export interface ApiKeySummary {
	id: string;
	name: string | null;
	/**
	 * The key's first characters, stored by the plugin so a UI can render
	 * something recognisable. Enough to match against a key you hold, useless to
	 * anyone who only has this.
	 */
	start: string | null;
	/** ISO 8601. Serialised as a string so the wire shape is unambiguous. */
	createdAt: string;
	/** ISO 8601, or `null` when the key has never been used. */
	lastRequest: string | null;
}

export type ApiKeyStatus =
	/** Signed in, no key issued yet. */
	| { status: "none" }
	| { status: "active"; key: ApiKeySummary }
	/** The lookup failed. Rendered as a warning, not as "you have no key". */
	| { status: "unavailable" };

/** The one moment the plaintext key is available. */
export interface IssuedApiKey {
	/** Show once, store never. */
	key: string;
	summary: ApiKeySummary;
}

export const API_KEY_QUERY_KEY = ["api-key"] as const;

/**
 * Shape of a key row as the plugin returns it, narrowed to what is rendered.
 *
 * Declared structurally rather than imported: the plugin's own `ApiKey` type
 * describes the database row, and half of it (hash, refill schedule, permission
 * map) is neither needed here nor safe to hand to the browser.
 */
interface ApiKeyRow {
	id: string;
	name: string | null;
	start: string | null;
	createdAt: Date;
	lastRequest: Date | null;
}

function toSummary(row: ApiKeyRow): ApiKeySummary {
	return {
		id: row.id,
		name: row.name,
		start: row.start,
		createdAt: row.createdAt.toISOString(),
		lastRequest: row.lastRequest?.toISOString() ?? null,
	};
}

/**
 * Resolve the caller's session or refuse.
 *
 * A server function is an HTTP endpoint like any other: the dashboard's route
 * guard does not protect it, so every mutation below re-checks for itself.
 */
async function requireUserId(headers: Headers): Promise<string> {
	const session = await getAuth().api.getSession({ headers });

	if (!session) {
		log.warn("rejected an unauthenticated api key request");
		throw new Error("Sign in to manage your API key.");
	}

	return session.user.id;
}

export const fetchApiKeyStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<ApiKeyStatus> => {
		const headers = getRequest().headers;

		let keys: ApiKeyRow[];
		try {
			const result = await getAuth().api.listApiKeys({ headers });
			keys = result.apiKeys;
		} catch (error) {
			// Behind the dashboard guard a missing session cannot happen, so this
			// is a database or adapter failure. Degrade to a warning rather than
			// taking the whole page down over one card.
			log.error("could not list api keys", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { status: "unavailable" };
		}

		if (keys.length === 0) {
			return { status: "none" };
		}

		// Only reachable for a user whose keys predate the one-key rule. Showing
		// the newest matches what issuing would have left behind, and the warning
		// is what makes the leftovers findable.
		const [newest] = [...keys].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		);
		if (keys.length > 1) {
			log.warn("user holds multiple api keys; showing the newest", {
				count: keys.length,
				keyId: newest.id,
			});
		}

		return { status: "active", key: toSummary(newest) };
	},
);

/**
 * Issue a key, replacing any the user already has.
 *
 * Deletion comes first on purpose. The other order leaves two working keys if
 * the delete then fails, and a user who has just been told their old key was
 * replaced would have no reason to suspect it still opens the door. Failing the
 * other way costs a second click.
 */
export const issueApiKey = createServerFn({ method: "POST" }).handler(
	async (): Promise<IssuedApiKey> => {
		const headers = getRequest().headers;
		const userId = await requireUserId(headers);
		const auth = getAuth();

		const { apiKeys } = await auth.api.listApiKeys({ headers });
		for (const existing of apiKeys) {
			await auth.api.deleteApiKey({ body: { keyId: existing.id }, headers });
			log.info("revoked api key before reissue", { keyId: existing.id });
		}

		// No `headers`, so the plugin treats this as a server call and takes the
		// user from `userId`. Passing headers instead would make it a client
		// request, which is the mode that rejects server-only fields.
		const created = await auth.api.createApiKey({
			body: { userId, name: API_KEY_NAME },
		});

		log.info("issued api key", { keyId: created.id, replaced: apiKeys.length });

		return { key: created.key, summary: toSummary(created) };
	},
);

export const revokeApiKey = createServerFn({ method: "POST" }).handler(
	async (): Promise<{ revoked: number }> => {
		const headers = getRequest().headers;
		await requireUserId(headers);
		const auth = getAuth();

		const { apiKeys } = await auth.api.listApiKeys({ headers });
		for (const existing of apiKeys) {
			await auth.api.deleteApiKey({ body: { keyId: existing.id }, headers });
			log.info("revoked api key", { keyId: existing.id });
		}

		return { revoked: apiKeys.length };
	},
);

export function apiKeyQueryOptions() {
	return queryOptions({
		queryKey: API_KEY_QUERY_KEY,
		queryFn: () => fetchApiKeyStatus(),
		// Only this app's own mutations change the answer, and they invalidate the
		// cache themselves, so the window only exists to avoid refetching on every
		// navigation back to the dashboard.
		staleTime: 60_000,
	});
}
