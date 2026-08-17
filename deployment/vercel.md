# Deploy to Vercel with Turso

Use this path when the application runs on Vercel and the database is
Turso (libSQL). For Docker Compose, see [`README.md`](README.md). For a
self-contained Nitro Node server, see [`nitro.md`](nitro.md).

Nitro detects Vercel with no configuration, so the only thing this project adds is the
migration step, wired in two places:

```json
// package.json — Vercel prefers `vercel-build` over `build` when it exists
"vercel-build": "pnpm db:migrate && vite build"

// vercel.json — pins it, so a Build Command set in the dashboard cannot skip migrations
{ "buildCommand": "pnpm vercel-build" }
```

## 1. Create the database

```bash
turso db create google-health-connector
turso db show   google-health-connector --url   # -> libsql://<db>-<org>.turso.io
turso db tokens create google-health-connector  # -> the auth token
```

## 2. Set the environment variables

All of them must exist in the **Production** environment, and `DATABASE_URL` /
`TURSO_AUTH_TOKEN` are read at *build* time as well as at run time — that is when
migrations are applied.

| Variable               | Value                                                     |
| ---------------------- | --------------------------------------------------------- |
| `DATABASE_URL`         | `libsql://<db>-<org>.turso.io` (from `turso db show --url`) |
| `TURSO_AUTH_TOKEN`     | from `turso db tokens create`                              |
| `BETTER_AUTH_SECRET`   | `openssl rand -base64 32` — immutable per environment; rotation is a [full auth outage](../development.md#secret-rotation) |
| `BETTER_AUTH_URL`      | the deployed bare origin and OAuth issuer, e.g. `https://<project>.vercel.app`, with no path or trailing slash |
| `MCP_OAUTH_ENABLED`    | `true` only after the OAuth schema, discovery routes and MCP bearer verification are deployed |
| `GOOGLE_CLIENT_ID`     | Google Cloud Console → Credentials                          |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials                          |
| `LOG_LEVEL`            | optional; defaults to `error` in production                 |

Either paste them into **Project Settings → Environment Variables**, or:

```bash
vercel env add DATABASE_URL production
vercel env add TURSO_AUTH_TOKEN production
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production
vercel env add MCP_OAUTH_ENABLED production
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
```

## 3. Point Google at the deployed origin

The redirect URI is derived from `BETTER_AUTH_URL`, so the production one has to be
whitelisted separately from localhost — see [Google sign-in](../development.md#google-sign-in):

- *Authorized redirect URI*: `<BETTER_AUTH_URL>/api/auth/callback/google`
- *Authorized JavaScript origin*: `<BETTER_AUTH_URL>`

## 4. Deploy

```bash
vercel deploy --prod
```

The build applies `drizzle/sqlite/*` to the empty Turso database before bundling. If the
database already has tables from `pnpm test:pushdb`, baseline it once first, or the build
fails with `table … already exists`:

```bash
DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… pnpm db:baseline
```

## Things worth knowing before the first deploy

- **Preview deployments migrate whatever they point at.** If previews inherit the
  production `DATABASE_URL`, a preview build applies migrations to production. Give the
  Preview environment its own Turso database if that is not what you want.
- **A failed migration fails the build**, which is the intent: it stops a deploy whose code
  expects a schema the database does not have.
- **Latency follows the Turso primary.** Writes go to it wherever the function runs, so
  pin the function near it — `turso db show <db>` prints the primary's location, and
  `"regions": ["iad1"]` in `vercel.json` pins the function. Reads can be served locally by
  adding replicas (`turso db replicate <db> <location>`).
- **Do not rotate `BETTER_AUTH_SECRET` as routine maintenance.** It now protects sessions,
  Google tokens and MCP signing material. Follow [Secret rotation](../development.md#secret-rotation) when
  compromise makes the outage necessary.

The same steps work for PostgreSQL or MySQL: change `DATABASE_URL`, drop
`TURSO_AUTH_TOKEN`, and the build applies that dialect's migrations instead. Connections
are capped at `MAX_POOL_CONNECTIONS` (5) per process in `src/db/client.server.ts`;
serverless multiplies that by the number of warm instances, so past a handful the answer is
a pooler in front of the database — PgBouncer, Neon's pooled endpoint, PlanetScale — not a
larger number. Turso is exempt: it is stateless HTTP and pools nothing.
