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
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
