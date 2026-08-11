import { createFileRoute } from "@tanstack/react-router";
import { getAuthBaseUrl, isMcpOAuthEnabled } from "../../../lib/env.server";
import {
	oauthMetadataHeadResponse,
	oauthMetadataOptionsResponse,
	oauthMetadataUnavailableResponse,
	protectedResourceMetadataResponse,
} from "../../../lib/mcp/oauth-metadata";

function getMetadata(): Response {
	return isMcpOAuthEnabled()
		? protectedResourceMetadataResponse(getAuthBaseUrl())
		: oauthMetadataUnavailableResponse();
}

function options(): Response {
	return isMcpOAuthEnabled()
		? oauthMetadataOptionsResponse()
		: oauthMetadataUnavailableResponse();
}

export const Route = createFileRoute("/.well-known/oauth-protected-resource/")({
	server: {
		handlers: {
			GET: getMetadata,
			HEAD: () => oauthMetadataHeadResponse(getMetadata()),
			OPTIONS: options,
		},
	},
});
