import { type ConsentScopeCopy, describeConsentScopes } from "./oauth-consent";

const SCOPE_SEPARATOR = /\s+/;

/** Database models that hold credentials derived from an OAuth grant. */
export const OAUTH_GRANT_TOKEN_MODELS = [
	"oauthAccessToken",
	"oauthRefreshToken",
] as const;

export interface OAuthGrantRecord {
	id: string;
	clientId: string;
	clientName?: string | null;
	redirectUris: unknown;
	scopes: unknown;
	createdAt: Date;
}

/** Browser-safe grant details shown on the Connected apps card. */
export interface OAuthGrantSummary {
	id: string;
	clientName: string;
	redirectUris: readonly string[];
	scopes: readonly ConsentScopeCopy[];
	/** ISO 8601. A string keeps server and browser rendering deterministic. */
	approvedAt: string;
}

export interface OAuthGrantTokenWhere {
	field: "userId" | "clientId";
	value: string;
}

function parseJsonArray(value: string): unknown {
	if (!(value.startsWith("[") && value.endsWith("]"))) return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function normalizeStringList(
	value: unknown,
	stringSeparator?: RegExp,
): readonly string[] {
	const parsed =
		typeof value === "string" ? parseJsonArray(value.trim()) : value;
	let candidates: readonly unknown[] = [parsed];
	if (Array.isArray(parsed)) {
		candidates = parsed;
	} else if (typeof parsed === "string" && stringSeparator !== undefined) {
		candidates = parsed.split(stringSeparator);
	}
	const result: string[] = [];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const normalized = candidate.trim();
		if (normalized === "" || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}

	return result;
}

/** The exact adapter predicates used to remove one user's client tokens. */
export function oauthGrantTokenWhere(
	userId: string,
	clientId: string,
): readonly OAuthGrantTokenWhere[] {
	return [
		{ field: "userId", value: userId },
		{ field: "clientId", value: clientId },
	];
}

/** Map adapter/API records to copy and sort newest approval first. */
export function summarizeOAuthGrants(
	records: readonly OAuthGrantRecord[],
): readonly OAuthGrantSummary[] {
	return records
		.map((record) => {
			const clientName = record.clientName?.trim() || "Unnamed OAuth client";
			const scopeNames = normalizeStringList(record.scopes, SCOPE_SEPARATOR);

			return {
				id: record.id,
				clientName,
				redirectUris: normalizeStringList(record.redirectUris),
				scopes: describeConsentScopes(scopeNames),
				approvedAt: record.createdAt.toISOString(),
			};
		})
		.sort(
			(a, b) =>
				b.approvedAt.localeCompare(a.approvedAt) || a.id.localeCompare(b.id),
		);
}
