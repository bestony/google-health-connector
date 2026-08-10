import { getAuth } from "./src/lib/auth.server";

/**
 * Entry point for the better-auth CLI only (`pnpm auth:generate`).
 *
 * The CLI insists on a module that exports an eagerly-created instance named
 * `auth`, while the application deliberately builds it lazily through
 * `getAuth()`. This shim bridges the two; nothing in `src/` imports it.
 */
export const auth = getAuth();
