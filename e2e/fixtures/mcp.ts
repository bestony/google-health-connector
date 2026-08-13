import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { Account } from "./test";

export const initializeRequest = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "google-health-connector-e2e", version: "1.0.0" },
	},
} as const;

export async function mcpPost(
	request: APIRequestContext,
	body: unknown,
	options: { apiKey?: string; cookie?: Account["sessionCookie"] } = {},
): Promise<APIResponse> {
	const headers: Record<string, string> = {
		Accept: "application/json, text/event-stream",
		"Content-Type": "application/json",
	};
	if (options.apiKey !== undefined) {
		headers["x-api-key"] = options.apiKey;
	}
	if (options.cookie !== undefined) {
		headers.Cookie = options.cookie;
	}
	return request.post("/mcp", { headers, data: body });
}

export async function rawMcpPost(
	request: APIRequestContext,
	body: unknown,
	headers: Record<string, string>,
): Promise<APIResponse> {
	return request.post("/mcp", { headers, data: body });
}

export async function rpcBody(
	response: APIResponse,
): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}
