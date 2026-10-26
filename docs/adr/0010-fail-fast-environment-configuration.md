# 0010. Fail fast on missing configuration and never default it in code

Status: Accepted

Date: 2026-09-10

## Context

Runtime configuration comes from `.env`, seeded from `.env.example` ([AGENTS.md](../../AGENTS.md), "Configuration and environment variables"). That section also forbids `process.env.VAR ?? "default"` in service bootstrap code and `${VAR:-default}` in `docker-compose.yml`. AGENTS.md is staged but not committed, so the date is that of the first commit that enforced the rule in code.

The repository does not write down the reason. The commits show what it prevents. The 2026-06-05 release package (de4fa75) had `${VAR:-default}` values in Compose; commit 01e90dc (2026-09-10) removed them. Payment-service defaulted `SALES_SERVICE_URL` and `CATALOG_SERVICE_URL` to localhost; commit 092b031 (2026-10-08) removed those defaults, which its message describes as "instead of falling back to localhost". Commit 7893dd1 (2026-10-08) made the service URLs and `INTERNAL_SERVICE_SECRET` required at boot in sales-service. Commit de89336 (2026-10-08) says a service generated from the template now stops at boot, where it used to "quietly listen on 3000" when `PORT` was unset.

## Decision

- All runtime configuration comes from `.env`, with the AI feature settings as the exception ([ADR 0009](0009-ai-feature-settings-in-database.md)). Compose reads the same file.
- Each service checks its required variables in its bootstrap and throws at startup with "Missing required environment variable: NAME. Please set it in your .env file." Examples: `apps/catalog-service/src/main.ts`, `apps/chatbot-service/src/main.ts`, `apps/sales-service/src/main.ts`, `apps/identity-service/src/main.ts`, and `apps/identity-service/src/telemetry.ts` for the OTLP endpoint.
- Search-service applies the same rule in Go. `internal/config/config.go` has no defaults, and it treats an empty value as unset, because Compose passes unset variables as empty strings.
- `docker-compose.yml` uses bare `${VAR}` references, for example the `AI_EMBEDDING_*` values of catalog-service and search-service.
- The web Vite configs throw when the serving port is missing (`servePort()` in `apps/staff-web/vite.config.ts`).

## Consequences

- A misconfigured service stops at boot and names the variable, instead of connecting to localhost. The cost is that a fresh checkout needs a complete `.env` copied from `.env.example`.
- Every new variable must be added to `.env.example`, to Compose where it is used, and to the service that reads it.
- Deviations found in the current tree (not changed by this ADR):
  - `drizzle.config.ts` in seven services falls back to `postgres://...:change_this_password@localhost` when `DATABASE_URL` is unset.
  - `logger.ts` in six services uses `LOG_LEVEL ?? "info"`.
  - `apps/identity-service/src/bootstrap/dependencies.ts` chooses `EMAIL_PROVIDER` from `NODE_ENV` when it is unset.
  - `createCatalogDatabase()`, `createIdentityDatabase()`, `createInventoryDatabase()`, `createOperationsDatabase()`, `createPaymentDatabase()` and `createSalesDatabase()` return `undefined` without `DATABASE_URL`. Those services start with no database, and routes that need it answer 503 (for example the credential routes in `apps/catalog-service/src/main.ts`). The reason is not recorded in the repository.
  - `apps/nginx-entrypoint.sh` starts the web image without `API_BASE_URL` and serves a 502 "API_BASE_URL is not configured" on `/api/`, instead of failing at startup.
  - The web Vite configs use `process.env.API_BASE_URL ?? rootEnv.API_BASE_URL` and skip the dev proxy when it is unset.

## Alternatives considered

- Defaults for local development in Compose and the services, as in the 2026-06-05 release package (de4fa75). The commits above replaced them.
