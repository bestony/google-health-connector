import { protectedResourceMetadata } from "./oauth-scopes";

/** Browser-readable headers shared by the four public discovery routes. */
export const OAUTH_METADATA_CORS_HEADERS = {
	"Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
	"Access-Control-Allow-Origin": "*",
} as const;

const METADATA_CACHE_CONTROL =
	"public, max-age=15, stale-while-revalidate=15, stale-if-error=86400";

/** The kill switch makes discovery indistinguishable from an absent surface. */
export function oauthMetadataUnavailableResponse(): Response {
	return Response.json(
		{ error: "Not found" },
		{
			status: 404,
			headers: {
				...OAUTH_METADATA_CORS_HEADERS,
				"Cache-Control": "no-store",
			},
		},
	);
}

/** CORS preflight for an enabled metadata route. */
export function oauthMetadataOptionsResponse(): Response {
	return new Response(null, {
		status: 204,
		headers: OAUTH_METADATA_CORS_HEADERS,
	});
}

/** Byte-stable RFC 9728 document used at both protected-resource paths. */
export function protectedResourceMetadataResponse(baseUrl: string): Response {
	return Response.json(protectedResourceMetadata(baseUrl), {
		headers: {
			...OAUTH_METADATA_CORS_HEADERS,
			"Cache-Control": METADATA_CACHE_CONTROL,
		},
	});
}

/** Preserve status and headers for HEAD while removing the generated body. */
export function oauthMetadataHeadResponse(response: Response): Response {
	return new Response(null, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
