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

For host-specific presets (Vercel, Netlify, Cloudflare, AWS Lambda, etc.) and tuning, see https://v3.nitro.build/deploy.
