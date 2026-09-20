# Nitro and standalone Docker

Use this path when you run the Nitro Node server yourself, or when you
build the application image without Compose. For the Compose examples,
see [`README.md`](README.md). For Vercel, see [`vercel.md`](vercel.md).

## Building for production

To build this application for production:

```bash
pnpm build
```

## Deploy with Nitro

This project uses Nitro as a generic server adapter, so it can run on any Node-compatible host.

```bash
pnpm build
node .output/server/index.mjs
```

The build output is a self-contained Node server. To deploy, push the `.output/` directory to your host (Render, Fly.io, your own VPS, etc.) and run the server command above.

## Deploy a standalone Docker image

The multi-stage `Dockerfile` builds the self-contained Nitro Node server and runs it as the unprivileged `node` user. Database migrations are deliberately kept out of both the image build and the application startup, so they can be reviewed and run as a separate deployment step.

Build and run the application image:

```bash
docker build --tag google-health-connector:local .
docker run --rm --publish 3000:3000 --env-file .env google-health-connector:local
```

Build and run the one-off migration target before starting the application:

```bash
docker build --target migration --tag google-health-connector:migrate .
docker run --rm --env-file .env google-health-connector:migrate
```

The runtime listens on `0.0.0.0:3000` by default. Set `NITRO_PORT` to use a different port. The deployment environment must provide the database and authentication settings required by the application, including `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`; add provider-specific variables such as `TURSO_AUTH_TOKEN` when applicable. The image healthcheck requests `/privacy`.

## Google OAuth callback

`BETTER_AUTH_URL` is the public origin users open, not the address Nitro
binds. If a reverse proxy terminates TLS at `https://health.example.com`
and forwards to `127.0.0.1:3000`, set
`BETTER_AUTH_URL=https://health.example.com` and register this redirect
URI:

```text
https://health.example.com/api/auth/callback/google
```

The Authorized JavaScript origin is the same public origin with no path.
See [`google-oauth.md`](google-oauth.md) for the Console steps and the
mistakes that produce `redirect_uri_mismatch`.

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.

## Background health sync

Nothing runs the sync from inside the process. Something outside has to call
its endpoint on a schedule; a systemd timer is the least surprising choice.

```ini
# /etc/systemd/system/ghc-sync.service
[Unit]
Description=Google Health Connector sync slice
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/ghc/sync.env          # CRON_SECRET=...
ExecStart=/usr/bin/curl -fsS -m 300 -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  http://127.0.0.1:3000/api/cron/sync
```

```ini
# /etc/systemd/system/ghc-sync.timer
[Unit]
Description=Run a Google Health sync slice every ten minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true
AccuracySec=1min

[Install]
WantedBy=timers.target
```

`Persistent=true` is the reason to prefer a timer over a crontab line: a host
that was down overnight runs the missed slice on boot. Because the work a run
owes is derived from sync state rather than from a queue, that slice picks up
exactly the debt that accumulated — there is nothing to replay and nothing to
have missed.

Set `HEALTH_SYNC_ENABLED=true`, a long random `CRON_SECRET`, and
`HEALTH_SYNC_BUDGET_MS=120000` — there is no function timeout here, and a
two-minute slice drains a backfill roughly fifteen times faster than Vercel's
Hobby budget. `LOG_LEVEL=info` makes the per-run summary visible; the
production default of `error` hides it.

Multiple replicas are safe: a database lease serialises invocations, and a
replica that loses the race returns `{"outcome":"skipped_locked"}` with a 200.

**An in-process timer was considered and rejected.** It would be a second code
path existing on one platform only, it breaks under multiple replicas, and this
deployment guide's whole shape assumes no long-lived work inside the server.
Please do not add one.
