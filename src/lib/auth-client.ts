import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side better-auth client.
 *
 * No `baseURL` is configured on purpose: the auth endpoints are mounted on this
 * same app at `/api/auth/*`, so the client defaults to the current origin and
 * keeps working across localhost, preview and production without extra config.
 *
 * This module is isomorphic — it holds no secrets and is safe to import from
 * components. Anything that needs the secret lives in `auth.server.ts`.
 *
 * `sig` is a reserved query parameter across the whole app. When it is present,
 * the OAuth client plugin carries the authorization server's signed query into
 * non-GET auth requests so sign-in and consent can resume the same flow.
 */
export const authClient = createAuthClient({
	plugins: [oauthProviderClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
