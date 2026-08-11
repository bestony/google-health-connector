import { GOOGLE_HEALTH_DATA_TYPES } from "./google-health-scopes";
import { MCP_OAUTH_SCOPE } from "./mcp/oauth-scopes";

/**
 * Pure parsing and presentation facts for the OAuth consent route.
 *
 * The authorization provider signs the query before it redirects here. The
 * browser plugin later sends that signed query back unchanged, so this module
 * preserves every parameter the installed provider declares and every
 * extension parameter named by its repeated `ba_param` entries.
 */

type SearchScalar = string | number | boolean;
type SearchValue = SearchScalar | readonly SearchScalar[];

export interface OAuthConsentSearch {
	[key: string]: SearchValue | undefined;
	client_id?: SearchValue;
	scope?: SearchValue;
	redirect_uri?: SearchValue;
	sig?: SearchValue;
	ba_param?: SearchValue;
}

export type ParsedConsentRequest =
	| {
			status: "unsigned";
			signed: false;
			clientId: string | null;
			redirectUri: string | null;
			scopes: readonly string[];
	  }
	| {
			status: "invalid";
			signed: true;
			reason: "missing-client-id";
			clientId: null;
			redirectUri: string | null;
			scopes: readonly string[];
	  }
	| {
			status: "ready";
			signed: true;
			clientId: string;
			redirectUri: string | null;
			scopes: readonly string[];
	  };

export interface ConsentScopeCopy {
	scope: string;
	label: string;
	description: string;
	known: boolean;
}

/**
 * Parameters declared by oauth-provider 1.6.26's authorization schema and
 * signed-query handoff. `ba_pl` is conditional on a post-login page, which this
 * app does not configure, but preserving it keeps this parser aligned with the
 * installed signer.
 */
const PROVIDER_QUERY_PARAMETERS = [
	"response_type",
	"request_uri",
	"redirect_uri",
	"scope",
	"state",
	"client_id",
	"prompt",
	"display",
	"ui_locales",
	"max_age",
	"acr_values",
	"login_hint",
	"id_token_hint",
	"code_challenge",
	"code_challenge_method",
	"nonce",
	"exp",
	"ba_iat",
	"ba_pl",
	"ba_param",
	"sig",
] as const;

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SCOPE_SEPARATOR = /\s+/;

const KNOWN_SCOPE_COPY: Readonly<
	Record<string, Omit<ConsentScopeCopy, "scope">>
> = {
	openid: {
		label: "Confirm your account identity",
		description: "Let the client identify the account that approved access.",
		known: true,
	},
	profile: {
		label: "Read your basic profile",
		description: "Share your display name and profile image.",
		known: true,
	},
	email: {
		label: "Read your email address",
		description: "Share the email address on this account.",
		known: true,
	},
	offline_access: {
		label: "Stay connected when you leave",
		description:
			"Let the client renew access without asking you to sign in again.",
		known: true,
	},
	[MCP_OAUTH_SCOPE]: {
		label: "Read your Google Health data through MCP",
		description: "Allow MCP requests for the health categories listed below.",
		known: true,
	},
};

/** Google Health copy derived from the same catalog as the privacy policy. */
export const GOOGLE_HEALTH_CONSENT_CATEGORIES = GOOGLE_HEALTH_DATA_TYPES.map(
	(dataType) => ({
		id: dataType.id,
		label: dataType.label,
		description: dataType.description,
	}),
);

function scalarToString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return String(value);
	return undefined;
}

function valuesFromUnknown(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		const scalar = scalarToString(value);
		return scalar === undefined ? [] : [scalar];
	}

	const values: string[] = [];
	for (const entry of value) {
		const scalar = scalarToString(entry);
		if (scalar !== undefined) values.push(scalar);
	}
	return values;
}

function firstValue(value: unknown): string | null {
	return valuesFromUnknown(value).at(0) ?? null;
}

function copySearchValue(
	result: OAuthConsentSearch,
	name: string,
	value: unknown,
): void {
	if (UNSAFE_OBJECT_KEYS.has(name)) return;
	if (
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		result[name] = value;
		return;
	}
	if (!Array.isArray(value)) return;

	const values: SearchScalar[] = [];
	for (const entry of value) {
		if (
			typeof entry === "string" ||
			typeof entry === "boolean" ||
			(typeof entry === "number" && Number.isFinite(entry))
		) {
			values.push(entry);
		}
	}
	if (values.length > 0) result[name] = values;
}

function searchRecordFromString(search: string): Record<string, unknown> {
	const record: Record<string, unknown> = Object.create(null);
	const params = new URLSearchParams(search);
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key);
		record[key] = values.length === 1 ? values[0] : values;
	}
	return record;
}

/**
 * Retain the provider's current parameters and signed extension parameters.
 *
 * The HMAC is still the security boundary. A caller can name an extra
 * `ba_param`, but the server rejects the request unless that name and value are
 * covered by the valid signature.
 */
export function validateConsentSearch(
	search: Record<string, unknown>,
): OAuthConsentSearch {
	const result: OAuthConsentSearch = {};
	const allowedNames = new Set<string>(PROVIDER_QUERY_PARAMETERS);
	for (const name of valuesFromUnknown(search.ba_param)) {
		allowedNames.add(name);
	}

	for (const name of allowedNames) {
		copySearchValue(result, name, search[name]);
	}
	return result;
}

/** Parse enough of a consent query to decide whether the page may POST. */
export function parseConsentRequest(
	input: string | Record<string, unknown>,
): ParsedConsentRequest {
	const source =
		typeof input === "string" ? searchRecordFromString(input) : input;
	const search = validateConsentSearch(source);
	const clientId = firstValue(search.client_id)?.trim() || null;
	const redirectUri = firstValue(search.redirect_uri)?.trim() || null;
	const signature = firstValue(search.sig)?.trim() || null;
	const scope = firstValue(search.scope);
	const scopes = scope?.split(SCOPE_SEPARATOR).filter(Boolean) ?? [];

	if (signature === null) {
		return {
			status: "unsigned",
			signed: false,
			clientId,
			redirectUri,
			scopes,
		};
	}
	if (clientId === null) {
		return {
			status: "invalid",
			signed: true,
			reason: "missing-client-id",
			clientId: null,
			redirectUri,
			scopes,
		};
	}
	return {
		status: "ready",
		signed: true,
		clientId,
		redirectUri,
		scopes,
	};
}

/** Turn requested OAuth scopes into user-facing capabilities. */
export function describeConsentScopes(
	scopes: readonly string[],
): readonly ConsentScopeCopy[] {
	return scopes.map((scope) => {
		const copy = KNOWN_SCOPE_COPY[scope];
		if (copy !== undefined) return { scope, ...copy };
		return {
			scope,
			label: scope,
			description: "A capability requested by this OAuth client.",
			known: false,
		};
	});
}

/** Whether the requested scopes expose the Google Health category catalog. */
export function requestsGoogleHealthData(scopes: readonly string[]): boolean {
	return scopes.includes(MCP_OAUTH_SCOPE);
}
