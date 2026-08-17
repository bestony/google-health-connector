# GHealth Connector

GHealth Connector is a [TanStack Start](https://tanstack.com/start) application
(React 19, Vite, Nitro). It turns a Google Health account into an MCP endpoint.

A user signs in, grants health scopes, then approves an OAuth application or
issues an API key. Clients call `POST /mcp`. The server reads Google Health
live. It does not store a copy of the health records.

**Hosted service:** [https://www.stillwarm.app/](https://www.stillwarm.app/)

## Hosted service

Use the deployed origin when you do not want to run the server yourself.

| Surface | URL |
| ------- | --- |
| Site | [https://www.stillwarm.app/](https://www.stillwarm.app/) |
| MCP endpoint | `https://www.stillwarm.app/mcp` |
| Privacy Policy | [https://www.stillwarm.app/privacy](https://www.stillwarm.app/privacy) |
| Terms of Service | [https://www.stillwarm.app/terms](https://www.stillwarm.app/terms) |
| Contact | [bestony@linux.com](mailto:bestony@linux.com) |

1. Open the site and sign in.
2. On `/dashboard`, authorize Google Health.
3. Approve an OAuth application, or issue one API key.
4. Point an MCP client at `https://www.stillwarm.app/mcp`.

OAuth-capable client. The first request has no header. Discovery starts from
the `401` challenge:

```sh
claude mcp add --transport http ghealth https://www.stillwarm.app/mcp
```

API-key client:

```sh
claude mcp add --transport http ghealth https://www.stillwarm.app/mcp \
  --header "Authorization: Bearer $GHEALTH_API_KEY"
```

The hosted endpoint exposes three tools:

| Tool | Arguments | Returns |
| ---- | --------- | ------- |
| `list_health_data_types` | none | Queryable data types, timing, and which consent categories are readable |
| `read_health_data` | `dataType`, `from`, `to`, `limit` | Summarised data points, with `truncated` and whether the history window was clamped |
| `get_health_profile` | none | Profile and settings — date of birth, height, biological sex, units |

See [MCP server](development.md#mcp-server) for authentication, scopes, and the
local walkthrough.

## Documentation

| Document | What it covers |
| -------- | -------------- |
| [Development](development.md) | Local setup, database dialects, authentication, Google Health, legal pages, API keys, MCP server, tests, and linting |
| [Deployment](deployment/README.md) | Docker Compose, [Vercel + Turso](deployment/vercel.md), and [Nitro / standalone Docker](deployment/nitro.md) |

## Self-hosted Docker

The repository publishes separate application and migration images to GitHub
Container Registry. See [`deployment/README.md`](deployment/README.md) for the
MySQL, PostgreSQL, and single-node SQLite Compose examples:

```bash
cp deployment/.env.example deployment/.env
docker compose --env-file deployment/.env -f deployment/compose.postgresql.yaml up -d
```

Pin `IMAGE_TAG` to the same full `sha-<commit-sha>` value for both images in a
production deployment. The migration service is a one-shot container and must
complete before the application starts. `docker compose down` keeps named
database volumes; `docker compose down -v` deletes them and all stored data.
