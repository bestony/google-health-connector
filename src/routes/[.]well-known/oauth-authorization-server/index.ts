import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../../../lib/auth.server";
import { isMcpOAuthEnabled } from "../../../lib/env.server";
import {
	OAUTH_METADATA_CORS_HEADERS,
	oauthMetadataHeadResponse,
	oauthMetadataOptionsResponse,
	oauthMetadataUnavailableResponse,
} from "../../../lib/mcp/oauth-metadata";

async function getMetadata(request: Request): Promise<Response> {
	if (!isMcpOAuthEnabled()) return oauthMetadataUnavailableResponse();
	return oauthProviderAuthServerMetadata(getAuth(), {
		headers: OAUTH_METADATA_CORS_HEADERS,
	})(request);
}

function options(): Response {
	return isMcpOAuthEnabled()
		? oauthMetadataOptionsResponse()
		: oauthMetadataUnavailableResponse();
}

export const Route = createFileRoute(
	"/.well-known/oauth-authorization-server/",
)({
	server: {
		handlers: {
			GET: ({ request }) => getMetadata(request),
			HEAD: async ({ request }) =>
				oauthMetadataHeadResponse(await getMetadata(request)),
			OPTIONS: options,
		},
	},
});
