# Deployment

This directory covers every supported way to run GHealth Connector.

| Path | When to use | Document |
| ---- | ----------- | -------- |
| Docker Compose | Self-host with SQLite, PostgreSQL, or MySQL | this file |
| Vercel + Turso | Serverless on Vercel | [`vercel.md`](vercel.md) |
| Nitro / standalone Docker | A Node host, or one image without Compose | [`nitro.md`](nitro.md) |
| Google OAuth callback | Authorized redirect URI and JavaScript origin | [`google-oauth.md`](google-oauth.md) |

Local setup, database dialects, authentication, and the MCP server are in
[`../development.md`](../development.md). The product overview is in
[`../README.md`](../README.md).

## Self-hosted Docker Compose

This directory contains three independent Docker Compose examples. Choose one
database for each deployment:

| File | Database | Deployment shape |
| --- | --- | --- |
| `compose.sqlite.yaml` | SQLite | One application replica on one host |
| `compose.postgresql.yaml` | PostgreSQL 17 | A PostgreSQL service on the Compose network |
| `compose.mysql.yaml` | MySQL 8.4 | A MySQL service on the Compose network |

The application and migration images are published separately:

```text
ghcr.io/bestony/google-health-connector
ghcr.io/bestony/google-health-connector-migration
```

The migration image is a one-shot helper. It never runs during image build or
from the application startup command. Compose waits for a successful migration
before it starts the application.

The examples use a shared default Compose project name. Use `-p` when multiple
database examples run on the same host, for example:

```bash
docker compose -p ghc-postgresql --env-file deployment/.env -f deployment/compose.postgresql.yaml up -d
```

## Prerequisites

- Docker Engine with Docker Compose v2.
- A host with network access to GitHub Container Registry.
- A public DNS name and TLS termination for an internet-facing deployment.

Copy the template and edit the copy. Keep the real file out of Git:

```bash
cp deployment/.env.example deployment/.env
openssl rand -base64 32
$EDITOR deployment/.env
```

Run every command with `--env-file deployment/.env`. Compose otherwise searches
for `.env` relative to the current project directory, which can select the
wrong file when the command is run from the repository root or another folder.

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the database password required by
the selected file must be set. MySQL also requires `MYSQL_ROOT_PASSWORD`.
`BETTER_AUTH_URL` is the public bare origin, such as
`https://health.example.com`; do not add a path or a trailing slash.

For PostgreSQL and MySQL, the password is embedded in `DATABASE_URL`. Use
URL-safe characters, or percent-encode reserved characters before storing the
password in `.env`. Do not put a raw `@`, `:`, `/`, `?`, `#`, or `%` in an
unencoded URL password.

## Select an image tag

`IMAGE_REGISTRY` defaults to `ghcr.io/bestony` and `IMAGE_TAG` defaults to
`latest`. `latest` is useful for a quick trial. Pin both services to the same
full commit tag for a repeatable production rollout:

```dotenv
IMAGE_TAG=sha-<full-commit-sha>
```

The application and migration packages use matching tags. Do not mix a runtime
image from one commit with a migration image from another commit.

## Start a deployment

Run one of the following commands from the repository root. The first command
validates interpolation without starting containers:

```bash
docker compose --env-file deployment/.env -f deployment/compose.sqlite.yaml config --quiet
docker compose --env-file deployment/.env -f deployment/compose.sqlite.yaml up -d
```

Replace `compose.sqlite.yaml` with `compose.postgresql.yaml` or
`compose.mysql.yaml` when selecting another database. Only the application
port is published (`${APP_PORT:-3000}:3000`); database ports are not exposed on
the host.

SQLite uses one named volume for the database and is limited to one application
replica on one host. Do not use it as a multi-node or multi-replica database.
The SQLite permission initializer runs once before migration and keeps the
application and migration containers non-root.

## Inspect a running deployment

The application inherits the Dockerfile health check, which requests
`GET /privacy`.

```bash
docker compose --env-file deployment/.env -f deployment/compose.sqlite.yaml ps
docker compose --env-file deployment/.env -f deployment/compose.sqlite.yaml logs --tail=200 app
docker compose --env-file deployment/.env -f deployment/compose.sqlite.yaml logs migration
curl --fail http://127.0.0.1:${APP_PORT:-3000}/privacy
```

Application logs are structured and default to `info`. Set `LOG_LEVEL=debug`
only while investigating a problem; never put tokens, cookies, authorization
headers, or full request bodies in logs.

The migration service exits with code 0 when it applies all pending migrations.
It is normal for `migration` to show an exited state after startup. If it fails,
inspect its logs, fix the database or environment, and run it again before
starting the application:

```bash
docker compose --env-file deployment/.env -f deployment/compose.postgresql.yaml run --rm migration
docker compose --env-file deployment/.env -f deployment/compose.postgresql.yaml up -d app
```

## Upgrade and rollback

Set one new `IMAGE_TAG` for both services, validate the Compose file, and
recreate the application. Compose starts a new migration container for the
selected image before it starts the application:

```bash
docker compose --env-file deployment/.env -f deployment/compose.postgresql.yaml config --quiet
docker compose --env-file deployment/.env -f deployment/compose.postgresql.yaml up -d
```

To roll back, set `IMAGE_TAG` to the previous known-good `sha-<full-commit-sha>`
and run the same command. Database migrations are forward-only; confirm that
the old application supports the current schema before rolling back an image.

`docker compose down` stops and removes containers but keeps named volumes.
Do not use `down -v` as a routine operation: it deletes the database volume and
all stored application data. Make an external backup before any maintenance
that could remove a volume.

## Google OAuth settings

Register the public origin in Google Cloud Console **before** you set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The full callback steps,
worked examples, and common mistakes are in
[`google-oauth.md`](google-oauth.md).

For `BETTER_AUTH_URL=https://health.example.com`:

| Google Cloud field | Value |
| ------------------ | ----- |
| Authorized redirect URI | `https://health.example.com/api/auth/callback/google` |
| Authorized JavaScript origin | `https://health.example.com` |

Do not register `http://127.0.0.1:3000` when TLS terminates in front of
Compose. Google sign-in and the later Google Health grant both return to
`/api/auth/callback/google`.

Keep `MCP_OAUTH_ENABLED=false` until the OAuth schema, discovery routes, and
client configuration are ready. Set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` together; leaving both empty disables Google sign-in and
keeps email/password sign-in available.

## Build locally instead of pulling GHCR images

The published images are the normal deployment path. To build both targets from
the checkout, tag both images with the full names expected by the Compose files,
and set `IMAGE_TAG=local` in `deployment/.env`:

```bash
docker build --target runtime -t google-health-connector:local .
docker build --target migration -t google-health-connector-migration:local .
docker tag google-health-connector:local ghcr.io/bestony/google-health-connector:local
docker tag google-health-connector-migration:local ghcr.io/bestony/google-health-connector-migration:local
```

Then run the selected Compose file with the same `--env-file` command shown
above. This local tag is independent of GHCR and is suitable only for a local
smoke test.

## Troubleshooting

- `DATABASE_PASSWORD is required`: set the variable in
  `deployment/.env` and pass `--env-file deployment/.env`.
- `migration` is unhealthy or exits non-zero: check the database health and
  migration logs. The migration image must use the same `IMAGE_TAG` as the
  application image.
- OAuth returns `redirect_uri_mismatch`: compare `BETTER_AUTH_URL` and the
  registered callback byte-for-byte, including scheme and port. See
  [`google-oauth.md`](google-oauth.md).
- The app is healthy but inaccessible: check `APP_PORT`, the host firewall,
  and the reverse proxy route. The database is reachable only by its Compose
  service name.
