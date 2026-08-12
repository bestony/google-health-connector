# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV COREPACK_HOME="$PNPM_HOME/corepack"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable \
	&& corepack prepare pnpm@11.1.2 --activate \
	&& chmod -R a+rX "$PNPM_HOME"

FROM base AS dependencies

RUN apt-get update \
	&& apt-get install --no-install-recommends --yes git \
	&& rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build a one-off migration image when a deployment needs to apply database
# migrations separately from the long-running application container:
#
#   docker build --target migration -t google-health-connector:migrate .
#   docker run --rm --env-file .env google-health-connector:migrate
FROM dependencies AS migration

COPY . .
RUN chown -R node:node /app
USER node
CMD ["pnpm", "db:migrate"]

FROM dependencies AS build

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV="production" \
	NITRO_HOST="0.0.0.0" \
	NITRO_PORT="3000"

WORKDIR /app

COPY --from=build --chown=node:node /app/.output ./.output

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.NITRO_PORT || process.env.PORT || 3000) + '/privacy').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", ".output/server/index.mjs"]
