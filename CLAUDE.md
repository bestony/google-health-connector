# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A TanStack Start (React 19 + Vite + Nitro) app that turns a user's Google Health
account into an MCP endpoint: sign in, grant health scopes, then approve an OAuth
application or issue an API key for `POST /mcp`. Health data is read live from
Google — no copy is stored server-side.

`README.md` is unusually detailed and is the source of truth for behaviour and
rationale; the sections on Database, Authentication, Google Health authorization,
The API client, Legal pages, API keys and MCP server are worth reading before
changing those areas.

## Commands

```bash
pnpm dev                    # vite dev on :3000
pnpm build                  # production build (Nitro output)
pnpm check                  # biome lint + format check — the pre-push gate; keep it at 0 errors
pnpm lint / pnpm format     # biome, individually
pnpm test                   # vitest unit suite; test:coverage enforces the 95% gate
npx tsc --noEmit            # typecheck — there is no pnpm script for it
```

Database (all driven by `DATABASE_URL`, see below):

```bash
pnpm db:migrate             # apply pending migrations to DATABASE_URL
pnpm db:generate            # generate a migration into drizzle/<dialect>/
pnpm db:baseline            # mark migration #1 applied without running it (post-`push` only)
pnpm db:studio              # drizzle-kit studio
pnpm test:pushdb            # drizzle-kit push — throwaway databases only
```

Code generation (all three write files that must never be hand-edited):

```bash
pnpm google-health:generate # rewrites src/lib/google-health-api.gen.ts from Google's discovery doc
pnpm auth:generate          # rewrites src/db/schema/<dialect>-auth.ts for all three dialects
pnpm generate-routes        # rewrites src/routeTree.gen.ts (the dev server also does this)
```

`pnpm db:generate` writes only the folder for the dialect `DATABASE_URL` currently
names, so generating for all three means running it three times with the variable
overridden per run (see README → Migrations).

### Testing and quality gates

Vitest is configured for unit tests. `pnpm test` runs the unit suite and
`pnpm test:coverage` enforces 95% minimum statement, branch, function and line
coverage for the hand-written domain and transport-boundary modules listed in
`vitest.config.ts`. Generated Google schema code and server adapters remain
integration/build-test scope. Verify changes with `pnpm test:coverage`,
`npx tsc --noEmit`, `pnpm check`, and by exercising the app (`pnpm dev`, or
`curl` against `/mcp` — README → MCP server has a working example).

`biome.json` enables a strict ruleset on top of `recommended`. Rules the codebase
already satisfied are pinned at `error`; pre-existing debt (nested ternaries, long
functions, variable shadowing, …) surfaces as `warn` — burn a warning down, then
promote its rule to `error`. The overrides encode deliberate architecture, not
convenience: generated files are unlinted, the logger wrappers may call `console`,
`env.server.ts` may read `process.env`, and the dialect schema set may re-export.
Do not silence a rule to land a change.

lefthook (`lefthook.yml`, installed by the `prepare` script) enforces the gates:
pre-commit runs `biome check --write` on staged files; pre-push runs `pnpm check`,
`tsc --noEmit` and `pnpm test:coverage`. All three are green at HEAD — a red gate
means your change broke it, not baseline noise.

## Architecture

### One variable decides the database

`DATABASE_URL`'s scheme selects the dialect, and the dialect selects everything
downstream — driver, Drizzle schema, better-auth adapter, migration folder. There is
deliberately no second `DB_DIALECT` that could contradict it.

```
src/db/dialect.ts        scheme -> "sqlite" | "postgresql" | "mysql". Keep import-free:
                         drizzle.config.ts, the migrator, the server and the browser all read it
src/db/client.server.ts  getDb() -> discriminated { dialect, db, close }
src/db/schema/index.ts   SCHEMAS: the Drizzle schema per dialect (all three imported statically,
                         which is what keeps getDb()/getAuth() synchronous)
drizzle/<dialect>/       migrations, one lineage per dialect
```

The three `src/db/schema/<dialect>.ts` modules describe the same tables under the
same column *names*; only the types differ. **They move as a set.** Editing one alone
is what produces an app that works on SQLite and falls over on Postgres. Each
re-exports its generated `<dialect>-auth.ts` sibling, which is how drizzle-kit picks
up the better-auth tables.

Turso is the only setup needing a second variable (`TURSO_AUTH_TOKEN`), because
libSQL sends its token as a bearer header rather than in the URL.

### Server/client boundary is carried by filenames

- `*.server.ts` — server-only. Never import from a component. May read `process.env`.
- `src/server.ts` — the *server entry*, not a `.server.ts` module. It is the framework's
  own `createStartHandler(defaultStreamHandler)` plus one correction: the SSR handler
  answers **500** to any request whose `Accept` is neither `text/html` nor the wildcard,
  and `html-only-refusal.server.ts` turns that into a `404` (README → MCP server). Wrap
  here rather than in a `src/start.ts` — creating a Start instance replaces the CSRF
  request middleware the framework otherwise installs by default.
- `*.gen.ts` / `<dialect>-auth.ts` / `routeTree.gen.ts` — generated. Regenerate, never edit.
- Everything else is isomorphic. Modules like `api-key.ts`, `session.ts` and
  `google-health-access.ts` export `createServerFn` handlers plus query options and
  are imported freely from routes and components — TanStack Start strips the
  `.handler()` body and its server imports from the client bundle.
- Pure-data modules (`google-health-scopes.ts`, `api-key-config.ts`, `plans.ts`,
  `legal.ts`, `dialect.ts`) are kept import-free on purpose so both sides can read them.

`src/lib/env.server.ts` is the only place `process.env` is read, and it reads inside
functions rather than at module scope so edge runtimes (which inject the environment
per request) see the values. Follow that pattern for new variables.

Imports use the `#/*` alias for `./src/*` (`#/lib/…`); `@/*` also resolves but `#/` is
what the code uses.

### Auth

better-auth over the Drizzle adapter, mounted at `/api/auth/*` by
`src/routes/api/auth/$.ts`. `src/routes/__root.tsx` resolves the session once in
`beforeLoad` and puts it on the router context, so routes guard with
`if (!context.session) throw redirect(...)` and no extra round trip.

Google sign-in is optional by design: absent credentials means the provider is not
registered and the UI hides the button (`src/lib/auth-providers.ts` is what the page
asks). A *half*-filled credential pair is always a typo and is surfaced as such.

After changing the better-auth config (plugins, `additionalFields`), run
`pnpm auth:generate`; its post-processor removes the legacy `relations()`
blocks, MySQL-incompatible JSON mode arguments, and MySQL foreign-key width
mismatches that the installed generators emit. Then generate a migration per
dialect.

`better-auth` and `@better-auth/oauth-provider` are an exact-version pair; pin
both and upgrade them together so their peer graph cannot drift.

The plugin order is `apiKey`, then the kill-switch-controlled `jwt` and
`oauthProvider`, then optional `oneTap`, with `tanstackStartCookies` always last.
The browser client also installs `oauthProviderClient` so signed authorization
requests survive `/login` and `/consent`. The JWT issuer is pinned to the bare
`BETTER_AUTH_URL` origin: better-auth's default `withPath()` adds `/api/auth`, which
would move RFC 8414 discovery away from the root URL that MCP clients derive.

The generated auth schemas contain `user`, `session`, `account`, `verification`,
`apikey`, `rateLimit`, `jwks`, `oauthClient`, `oauthConsent`, `oauthAccessToken` and
`oauthRefreshToken`. Regenerate every dialect after a plugin schema change.

### Google Health: four layers, each with a reason

```
google-health-scopes.ts        the scope catalog — pure data, drives everything else
google-health-client.ts        browser: POST /api/auth/link-social, then redirect to Google
google-health-access.ts        reads account.scope back: what Google actually granted
google-health-token.server.ts  access token, refreshed by better-auth
google-health-api.gen.ts       GENERATED: schema types + data type catalog
google-health-filter.ts        the time filter per data type — isomorphic, pure
google-health-api.server.ts    createGoogleHealthClient(): paths, pagination, typed errors
```

`GOOGLE_HEALTH_DATA_TYPES` in `google-health-scopes.ts` is the single catalog: the
authorize button, the consent request, the permission list *and the privacy policy's
disclosed-data table* are all derived from it. Add a data type there and everything
follows; never hand-write that list anywhere else.

Two traps the filter layer exists to encode: sleep filters on its *end* time (a night
that started before the window is the normal case), and ECG accepts only `>=` on start
time. A wrong filter returns an empty page rather than an error.

Every field on every generated type is optional — proto3 JSON omits defaults — so
narrow at the point of use.

### MCP server

`POST /mcp` only; `GET`/`DELETE` answer `405`. Stateless: a fresh `McpServer` **and**
transport per request (the SDK refuses to reuse a stateless transport, and it is what
makes the route correct on serverless).

```
src/lib/mcp/health.ts         domain logic — clamping, summarising, the catalog. No MCP/HTTP types
src/lib/mcp/server.ts         createMcpServer(identity): which tools exist, who may invoke them
src/lib/mcp/oauth-scopes.ts   canonical issuer, resource, audiences and scope sets — pure data
src/lib/mcp/oauth-metadata.ts public discovery response policy — pure response construction
src/lib/mcp/credential.ts     pure credential classification, scope and challenge decisions
src/lib/mcp/auth.server.ts    API-key/JWT verification and OAuth consent-grant liveness
src/lib/mcp/handler.server.ts Request -> Response bridge: transport, logging, teardown
src/lib/mcp/endpoint.ts       server-derived OAuth and API-key connection commands
src/lib/oauth-consent.ts      signed authorization-query parsing and consent copy — pure
src/lib/oauth-grants.ts       session-bound grant listing and revocation orchestration
src/routes/mcp.ts             the route
```

Adding a tool: write it as a plain function in `health.ts` (or a sibling), then
register it in `createMcpServer()`. Keeping logic out of the registration is what
lets it be tested without a transport.

Every `/mcp` request authenticates, including `initialize` and `tools/list`. A
request with no credential gets a `401` OAuth challenge. OAuth credential failures
keep the challenge, including a `403` for a missing `mcp:health:read` scope.
Invalid API keys and malformed or unsupported authorization values return `401`
without a challenge. A valid API key is an owner credential, while an OAuth
identity carries only its granted scopes. Never demote a malformed `Authorization`
header to anonymous. OAuth JWT verification is local, then one indexed consent
read keeps explicit revocation immediate; browser-session expiry does not revoke
the grant. Tool handlers repeat the scope check in-band so a directly constructed
server still cannot reach Google without permission.

### Legal pages are a compliance surface, not decoration

`/privacy` and `/terms` are what Google's OAuth verification review reads, and most
Google Health scopes are sensitive/restricted. Both routes must stay public (no
`beforeLoad` guard), stay linked from the footer that `__root.tsx` mounts everywhere,
keep the Limited Use disclosure close to verbatim, keep the in-product disclosure
above the authorize button, and keep the disclosed data types generated from
`GOOGLE_HEALTH_DATA_TYPES`. Operator, contact and dates live once in
`src/lib/legal.ts`; `LEGAL` also supplies the MCP server's advertised identity.
`/consent` is also part of this compliance surface: it must name the application
and redirect URI, derive health categories from the catalog, preserve the Limited
Use disclosure, and never bypass per-application consent. Cross-references use
`<Ref id="…" />` — never write a section number by hand.

## Conventions

- Biome, tab indentation, double quotes, organize-imports on. Run `pnpm check` before
  committing; `google-health-api.gen.ts` is formatted by its own generate script.
- Log through `createLogger(scope)` (`logger.server.ts` / `logger-client.ts`), never
  bare `console`. `LOG_LEVEL` defaults to `debug` outside production and `error` in it;
  useful scopes when debugging: `google-health:api`, `mcp:handler`, `mcp:server`, `db`.
  In the browser: `localStorage.setItem('app:logLevel', 'debug')`.
- Connection strings go through `redactConnectionString()` before reaching a log line.
- Rotating `BETTER_AUTH_SECRET` invalidates sessions and signed OAuth continuations,
  makes Google tokens and stored JWK private keys undecryptable, and breaks MCP
  client authorization. Treat it as immutable. A forced rotation requires deleting
  `jwks` rows and restarting every serving process to clear the 300-second verifier
  cache; follow the complete outage procedure in README.md.
- `AGENTS.md` is a generated index of TanStack "intent" guidance packs. When working
  on unfamiliar TanStack Router/Start surface, load the matching pack with the
  `pnpm dlx @tanstack/intent@latest load …` command listed there.
