import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as authSchema from "../db/auth-schema";
import { getDb } from "../db/client.server";
import { getAuthBaseUrl, getAuthSecret, getLogLevel } from "./env.server";
import { createLogger } from "./logger.server";

/**
 * better-auth server instance, backed by Drizzle + libSQL (SQLite).
 *
 * Built lazily for the same reason as the database client: environment
 * variables must be read per request-lifetime, and importing this module should
 * not perform I/O. Always go through `getAuth()` — never construct a second
 * instance, or sessions issued by one will not be readable by the other.
 */

const log = createLogger("auth");

function createAuth() {
	const baseURL = getAuthBaseUrl();
	log.info("creating better-auth instance", {
		baseURL,
		logLevel: getLogLevel(),
	});

	return betterAuth({
		appName: "google-health-connector",
		baseURL,
		secret: getAuthSecret(),

		// Drizzle owns the schema; `schema` must be passed explicitly because
		// drizzle-orm 1.x no longer exposes `db._.fullSchema` for SQLite.
		database: drizzleAdapter(getDb(), {
			provider: "sqlite",
			schema: authSchema,
		}),

		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
		},

		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
		},

		logger: {
			level: getLogLevel(),
		},

		// `tanstackStartCookies` writes Set-Cookie through TanStack Start's server
		// context. It hooks every response, so it MUST remain the last plugin.
		plugins: [tanstackStartCookies()],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

let instance: Auth | undefined;

/** Memoized better-auth instance. Safe to call from anywhere on the server. */
export function getAuth(): Auth {
	if (instance === undefined) {
		instance = createAuth();
	}
	return instance;
}
