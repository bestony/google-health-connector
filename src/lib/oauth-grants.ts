import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "./auth.server";
import { createLogger } from "./logger.server";
import {
	OAUTH_GRANT_TOKEN_MODELS,
	type OAuthGrantRecord,
	type OAuthGrantSummary,
	oauthGrantTokenWhere,
	summarizeOAuthGrants,
} from "./oauth-grant-summary";

/** Session-bound OAuth grant listing and revocation for Connected apps. */

const log = createLogger("oauth-grants");

export const OAUTH_GRANTS_QUERY_KEY = ["oauth-grants"] as const;

export type OAuthGrantsStatus =
	| { status: "ready"; grants: readonly OAuthGrantSummary[] }
	| { status: "unavailable" };

interface StoredOAuthClient {
	redirectUris?: unknown;
}

interface PublicOAuthClient {
	client_name?: string;
}

interface StoredOAuthConsentOwner {
	id: string;
	clientId: string;
}

interface OAuthConsentRecord {
	id: string;
	clientId: string;
	scopes: unknown;
	createdAt: Date;
}

function logClientLookupFailure(
	lookup: "public" | "stored",
	clientId: string,
	result: PromiseSettledResult<unknown>,
): void {
	if (result.status === "fulfilled") return;
	log.warn("could not resolve oauth grant client", {
		lookup,
		clientId,
		error:
			result.reason instanceof Error
				? result.reason.message
				: String(result.reason),
	});
}

async function resolveOAuthGrantRecord(
	consent: OAuthConsentRecord,
	publicClientLookup: Promise<PublicOAuthClient>,
	storedClientLookup: Promise<StoredOAuthClient | null>,
): Promise<OAuthGrantRecord> {
	const [publicClientResult, storedClientResult] = await Promise.allSettled([
		publicClientLookup,
		storedClientLookup,
	]);
	logClientLookupFailure("public", consent.clientId, publicClientResult);
	logClientLookupFailure("stored", consent.clientId, storedClientResult);

	return {
		id: consent.id,
		clientId: consent.clientId,
		clientName:
			publicClientResult.status === "fulfilled"
				? publicClientResult.value.client_name
				: undefined,
		redirectUris:
			storedClientResult.status === "fulfilled"
				? storedClientResult.value?.redirectUris
				: undefined,
		scopes: consent.scopes,
		createdAt: consent.createdAt,
	};
}

async function requireUserId(headers: Headers): Promise<string> {
	const session = await getAuth().api.getSession({ headers });
	if (!session) {
		log.warn("rejected an unauthenticated oauth grant request");
		throw new Error("Sign in to manage connected applications.");
	}
	return session.user.id;
}

export const fetchOAuthGrantsStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<OAuthGrantsStatus> => {
		const headers = getRequest().headers;
		await requireUserId(headers);
		const auth = getAuth();

		try {
			const [consents, context] = await Promise.all([
				auth.api.getOAuthConsents({ headers }),
				auth.$context,
			]);
			const records = await Promise.all(
				consents.map((consent) =>
					resolveOAuthGrantRecord(
						consent,
						auth.api.getOAuthClientPublic({
							headers,
							query: { client_id: consent.clientId },
						}),
						context.adapter.findOne<StoredOAuthClient>({
							model: "oauthClient",
							where: [{ field: "clientId", value: consent.clientId }],
							select: ["redirectUris"],
						}),
					),
				),
			);

			return { status: "ready", grants: summarizeOAuthGrants(records) };
		} catch (error) {
			log.error("could not list oauth grants", {
				error: error instanceof Error ? error.message : String(error),
			});
			return { status: "unavailable" };
		}
	},
);

function validateRevokeInput(input: unknown): { consentId: string } {
	if (typeof input !== "object" || input === null || !("consentId" in input)) {
		throw new Error("An OAuth consent identifier is required.");
	}
	const consentId = input.consentId;
	if (typeof consentId !== "string" || consentId.trim() === "") {
		throw new Error("An OAuth consent identifier is required.");
	}
	return { consentId: consentId.trim() };
}

export const revokeOAuthGrant = createServerFn({ method: "POST" })
	.validator(validateRevokeInput)
	.handler(async ({ data }): Promise<{ revoked: true }> => {
		const headers = getRequest().headers;
		const userId = await requireUserId(headers);
		const auth = getAuth();
		const context = await auth.$context;
		const consent = await context.adapter.findOne<StoredOAuthConsentOwner>({
			model: "oauthConsent",
			where: [
				{ field: "id", value: data.consentId },
				{ field: "userId", value: userId },
			],
			select: ["id", "clientId"],
		});

		if (!consent) {
			throw new Error("This application approval no longer exists.");
		}

		let consentDeleted = false;
		try {
			// Delete consent first. `/mcp` checks that row on every OAuth request,
			// so even a later cleanup failure cannot leave the JWT usable.
			await auth.api.deleteOAuthConsent({
				body: { id: consent.id },
				headers,
			});
			consentDeleted = true;

			const where = [...oauthGrantTokenWhere(userId, consent.clientId)];
			const [accessTokenModel, refreshTokenModel] = OAUTH_GRANT_TOKEN_MODELS;
			await context.adapter.deleteMany({ model: accessTokenModel, where });
			await context.adapter.deleteMany({ model: refreshTokenModel, where });
		} catch (error) {
			log.error("could not complete oauth grant revocation", {
				consentDeleted,
				consentId: consent.id,
				clientId: consent.clientId,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new Error(
				consentDeleted
					? "The approval was revoked, but stored token cleanup failed."
					: "Could not revoke this application approval.",
				{ cause: error },
			);
		}

		log.info("revoked oauth grant and stored tokens", {
			consentId: consent.id,
			clientId: consent.clientId,
		});
		return { revoked: true };
	});

export function oauthGrantsQueryOptions() {
	return queryOptions({
		queryKey: OAUTH_GRANTS_QUERY_KEY,
		queryFn: () => fetchOAuthGrantsStatus(),
		staleTime: 60_000,
	});
}
