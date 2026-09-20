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

The redirect URI is derived from `BETTER_AUTH_URL`. Production is a
different origin from localhost, so it needs its own row on the Google
OAuth client. The full callback steps are in
[`google-oauth.md`](google-oauth.md).

For `BETTER_AUTH_URL=https://<project>.vercel.app`:

| Google Cloud field | Value |
| ------------------ | ----- |
| Authorized redirect URI | `https://<project>.vercel.app/api/auth/callback/google` |
| Authorized JavaScript origin | `https://<project>.vercel.app` |

If you attach a custom domain, put **that** origin in `BETTER_AUTH_URL`
and register it instead of the `*.vercel.app` host. Preview deployments
use a different host; either add each preview origin, or give Preview
its own custom domain that is already registered.

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

## Background health sync

The sync runs as a Vercel Cron job calling this app's own endpoint.

**The schedule lives in `vite.config.ts`, not in `vercel.json`.** Nitro builds
this app through the Build Output API and writes `.vercel/output/config.json`
itself; it does not merge the repository's `vercel.json` into that file. A
`crons` block in `vercel.json` would therefore be a schedule that looks
configured and may never fire, which is the worst failure available to a job
nobody watches. Nitro's `vercel.config` passes straight through:

```ts
nitro({
  vercel: {
    config: {
      version: 3,
      crons: [{ path: "/api/cron/sync", schedule: "*/10 * * * *" }],
    },
    functions: { maxDuration: 60 },
  },
})
```

Confirm it after any change to that block:

```bash
NITRO_PRESET=vercel pnpm build
cat .vercel/output/config.json   # must contain your crons entry
```

Every ten minutes, which assumes **Vercel Pro**. The daily work needs one run a
day, but the backfill advances one chunk per user per invocation, so the
interval is what decides whether years of history take days or months. A run
that finds nothing owed costs one `idle` row.

`maxDuration` is app-wide rather than per-route because Nitro deploys the whole
app as a single function — the generated output routes `/(.*)` to one
`__server`. A ceiling costs nothing on its own; Vercel bills actual duration. 60
is Pro's default maximum; Pro allows raising it to 300, and
`HEALTH_SYNC_BUDGET_MS` must always stay below whatever it is set to, or the
platform kills a run while it is writing its own bookkeeping.

### Environment variables

| Variable | Value |
| --- | --- |
| `HEALTH_SYNC_ENABLED` | `true`. Anything else, including unset, makes both cron routes answer 404. |
| `CRON_SECRET` | A long random string. **The name matters**: Vercel attaches `Authorization: Bearer $CRON_SECRET` to its cron invocations only when a variable of exactly this name exists. |
| `HEALTH_SYNC_BUDGET_MS` | `50000` on Pro, comfortably under the 60-second ceiling. |
| `LOG_LEVEL` | `info`, so the two-line run summary is visible. The production default is `error`, which hides it. |

Turning the switch on does not store anyone's data. Each user opts in
separately from the History tab on `/dashboard`.

### On Hobby instead

Hobby allows a single cron per day and a 10-second function timeout, which is
roughly four users a night. Daily syncing keeps up at that rate for a handful of
users; the backfill advances one chunk per user per night, so a year of history
takes weeks. Use `"0 5 * * *"` and leave `HEALTH_SYNC_BUDGET_MS` at its 8000
default. The run log says what is happening — `moreWork: true` on every run
until the debt clears.

### Checking on it

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/status
```

The last twenty runs. A row with `finishedAt` null and an old `startedAt` is an
invocation the platform killed — the one failure that leaves no log line.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  'https://<your-app>/api/cron/sync?dryRun=1'
```

What the next run *would* do. Takes no lease and writes nothing, so it is safe
to run against production at any time.

**Preview deployments inherit crons only in production.** A preview build does
not run the sync, which is what you want given that previews may point at the
production database.
