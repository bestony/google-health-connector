import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import * as authSchema from "../db/auth-schema";
import { getDb } from "../db/client.server";
import {
	getAuthBaseUrl,
	getAuthSecret,
	getGoogleOAuthConfig,
	getLogLevel,
} from "./env.server";
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

type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;

/**
 * Google provider options, or `undefined` when the credentials are absent.
 *
 * The redirect URI Google must have whitelisted is derived from `baseURL`:
 * `<baseURL>/api/auth/callback/google`. Get it wrong and Google rejects the
 * authorization request with `redirect_uri_mismatch` before better-auth ever
 * sees it, so `BETTER_AUTH_URL` has to match the origin the app is served from.
 */
function googleProvider(): SocialProviders["google"] {
	const config = getGoogleOAuthConfig();

	if (config.status === "unconfigured") {
		// Both variables missing is a legitimate setup (email + password only);
		// exactly one missing is always a mistake, so it is worth an error even
		// at production's `error` log level.
		const level = config.missing.length === 1 ? "error" : "info";
		log[level]("google sign-in disabled", { missing: config.missing });
		return undefined;
	}

	log.info("google sign-in enabled", { clientId: config.clientId });

	return {
		clientId: config.clientId,
		clientSecret: config.clientSecret,

		// Ask for offline access so Google issues a refresh token: this app is
		// meant to keep reading the user's health data long after the browser
		// session is gone. Google only hands a refresh token out when the user
		// actually passes through the consent screen, which happens on the first
		// grant and whenever the requested scopes change. Add `consent` to
		// `prompt` below if a refresh token must be guaranteed on *every*
		// sign-in — at the cost of showing the consent screen every time.
		accessType: "offline",

		// Show the account chooser rather than silently reusing whichever Google
		// account the browser happens to be signed into.
		prompt: "select_account",
	};
}

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

		socialProviders: {
			google: googleProvider(),
		},

		account: {
			// A Google refresh token is a long-lived key to the user's Google data,
			// so it must not sit in the database in clear text. Encryption is keyed
			// off `BETTER_AUTH_SECRET`: rotating the secret makes stored tokens
			// undecryptable and forces every user through consent again.
			encryptOAuthTokens: true,

			accountLinking: {
				enabled: true,

				// Trust Google's `email_verified` claim as proof of ownership, so a
				// user who signed up with a password can later sign in with Google
				// and land on the same row instead of a duplicate.
				//
				// better-auth additionally requires the *local* account to be
				// verified before it links — that gate is what stops an attacker
				// from pre-registering a victim's address and inheriting their
				// Google identity. This app has no email verification flow yet, so
				// in practice an existing password account fails linking with
				// `account_not_linked`; `/login` explains that to the user.
				trustedProviders: ["google"],
			},
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
