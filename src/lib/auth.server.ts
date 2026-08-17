import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, oneTap } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "../db/client.server";
import type { DatabaseDialect } from "../db/dialect";
import { getSchema } from "../db/schema";
import { API_KEY_PREFIX, API_KEY_RATE_LIMIT } from "./api-key-config";
import {
	getAuthBaseUrl,
	getAuthSecret,
	getGoogleOAuthConfig,
	getLogLevel,
	isMcpOAuthEnabled,
} from "./env.server";
import { LEGAL } from "./legal";
import { createLogger } from "./logger.server";
import {
	MCP_OAUTH_ACCEPTED_SCOPES,
	MCP_OAUTH_SCOPE,
	MCP_OAUTH_TOKEN_LIFETIME,
	mcpOAuthAudiences,
	oauthIssuer,
} from "./mcp/oauth-scopes";

/**
 * better-auth server instance, backed by Drizzle on whichever database
 * `DATABASE_URL` names — Turso, a local SQLite file, PostgreSQL or MySQL.
 *
 * Built lazily for the same reason as the database client: environment
 * variables must be read per request-lifetime, and importing this module should
 * not perform I/O. Always go through `getAuth()` — never construct a second
 * instance, or sessions issued by one will not be readable by the other.
 */

const log = createLogger("auth");

/**
 * This app's dialect names → the drizzle adapter's `provider` values.
 *
 * They agree on two of three and disagree on the third (`postgresql` vs `pg`),
 * which is exactly the kind of mismatch worth writing down once instead of
 * guessing at the call site.
 */
const ADAPTER_PROVIDER: Readonly<
	Record<DatabaseDialect, "sqlite" | "pg" | "mysql">
> = {
	sqlite: "sqlite",
	postgresql: "pg",
	mysql: "mysql",
};

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
	const { dialect, db } = getDb();
	const mcpOAuthEnabled = isMcpOAuthEnabled();
	log.info("creating better-auth instance", {
		baseURL,
		dialect,
		logLevel: getLogLevel(),
		mcpOAuthEnabled,
	});

	// Resolved once: `googleProvider()` logs, and it decides below whether the
	// One Tap endpoint is worth mounting at all.
	const google = googleProvider();

	return betterAuth({
		// The brand rather than the package name: better-auth hands this to
		// anything that has to name the app to a user, so it should read the way
		// the header and the legal documents do.
		appName: LEGAL.appName,
		baseURL,
		secret: getAuthSecret(),

		// The JWT plugin otherwise exposes `GET /api/auth/token`, which turns a
		// cookie session into an audience-free JWT without an OAuth client,
		// requested scopes or consent. This does not disable
		// `POST /api/auth/oauth2/token`; OAuth tokens must leave through that
		// endpoint, where those bindings are enforced together.
		disabledPaths: mcpOAuthEnabled ? ["/token"] : [],

		// Store counters in the shared database rather than process memory. A
		// serverless cold start must not reset the unauthenticated registration
		// limit, and local development should exercise the same boundary.
		rateLimit: {
			enabled: true,
			storage: "database",
		},

		// Drizzle owns the schema; `schema` must be passed explicitly because
		// drizzle-orm 1.x no longer exposes `db._.fullSchema`. It has to be the
		// one matching `dialect` — the tables carry the same names across all
		// three, but a `pgTable` handed to a libSQL connection compiles fine and
		// fails at the first query.
		database: drizzleAdapter(db, {
			provider: ADAPTER_PROVIDER[dialect],
			schema: getSchema(dialect),
		}),

		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
		},

		socialProviders: {
			google,
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

		plugins: [
			// API keys are the manual owner-credential path for MCP clients that do
			// not complete OAuth. Keys are stored hashed, so the plaintext exists
			// exactly once — in the response to the call that created it — and the
			// dashboard says so.
			//
			// `enableSessionForAPIKeys` is left off (its default): with it on, any
			// request carrying `x-api-key` would be handed a full mocked session,
			// which would let a key meant for `/mcp` drive every other auth endpoint
			// as well. Nothing here needs that — `/mcp` verifies the key explicitly
			// and gets back the user id it needs.
			apiKey({
				defaultPrefix: API_KEY_PREFIX,
				rateLimit: {
					enabled: true,
					timeWindow: API_KEY_RATE_LIMIT.timeWindow,
					maxRequests: API_KEY_RATE_LIMIT.maxRequests,
				},
			}),

			// Conditional registration makes the kill switch remove every OAuth
			// endpoint instead of leaving mounted endpoints in a broken state.
			...(mcpOAuthEnabled
				? [
						/**
						 * Keep the issuer at the public origin. The JWT plugin otherwise uses
						 * better-auth's base URL with `/api/auth` appended, which moves the
						 * RFC 8414 discovery document away from the root path MCP clients use.
						 * The signing algorithm and curve must move only with a full JWK
						 * rotation because stored rows do not retain those values.
						 */
						jwt({ jwt: { issuer: oauthIssuer(baseURL) } }),

						// MCP clients discover and register themselves, so registration is
						// open but deliberately rate-limited. The provider forces these to be
						// public clients, rejects client_credentials, requires PKCE S256 and
						// rejects unsafe redirect schemes. Never pre-create a trusted client or
						// set skipConsent: every client must receive the user's approval.
						oauthProvider({
							loginPage: "/login",
							consentPage: "/consent",
							scopes: [...MCP_OAUTH_ACCEPTED_SCOPES],
							// AS and OIDC discovery describe every accepted scope. Protected-
							// resource metadata has its own narrower MCP request set so profile
							// scopes do not appear on the MCP consent screen by default.
							advertisedMetadata: {
								scopes_supported: [...MCP_OAUTH_ACCEPTED_SCOPES],
							},
							// Keep database token values at the provider's fixed 43-character
							// SHA-256 base64url digest. This is intentionally explicit even
							// though it is the default: MySQL generates varchar(255) for the
							// unique access-token and refresh-token columns, so storing raw
							// tokens here would make truncation a dialect-only production bug.
							storeTokens: "hashed",
							// A thirty-day grant, deliberately longer than the provider's
							// one-hour access token default. MCP clients that never run the
							// refresh-token grant are what force this; the rationale and the
							// reason it stays revocable live with the constant.
							accessTokenExpiresIn: MCP_OAUTH_TOKEN_LIFETIME.accessTokenSeconds,
							refreshTokenExpiresIn:
								MCP_OAUTH_TOKEN_LIFETIME.refreshTokenSeconds,
							refreshTokenReuseInterval:
								MCP_OAUTH_TOKEN_LIFETIME.refreshTokenReuseSeconds,
							allowDynamicClientRegistration: true,
							allowUnauthenticatedClientRegistration: true,
							clientRegistrationDefaultScopes: [
								"openid",
								"offline_access",
								MCP_OAUTH_SCOPE,
							],
							validAudiences: mcpOAuthAudiences(baseURL),
							// Root discovery routes are mounted explicitly because better-auth is
							// served below /api/auth. These confirmations silence only the matching
							// startup checks; no path-inserted metadata route is published.
							silenceWarnings: {
								oauthAuthServerConfig: true,
								openidConfig: true,
							},
							rateLimit: {
								token: { window: 60, max: 20 },
								authorize: { window: 60, max: 30 },
								introspect: { window: 60, max: 100 },
								revoke: { window: 60, max: 30 },
								register: { window: 60, max: 5 },
							},
						}),
					]
				: []),

			// Google One Tap: `POST /api/auth/one-tap/callback` trades the ID token
			// the browser gets from Google Identity Services for a session, with no
			// redirect round trip. It reuses `socialProviders.google.clientId` as
			// the token audience, which is why it is only mounted when Google is
			// configured — registering it unconfigured would answer every call with
			// a confusing "Google client ID is required" 400 instead of a 404.
			//
			// Sign-ups are allowed here, exactly as they are for the redirect flow,
			// and land in the same `account` table. Pass `disableSignup: true` to
			// restrict One Tap to users who already exist.
			...(google ? [oneTap()] : []),

			// `tanstackStartCookies` writes Set-Cookie through TanStack Start's
			// server context. It hooks every response, so it MUST remain last.
			tanstackStartCookies(),
		],
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
