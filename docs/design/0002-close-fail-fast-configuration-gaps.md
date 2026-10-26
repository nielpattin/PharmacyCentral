# 0002. Close the fail-fast configuration gaps

- **Status:** Draft
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

[AGENTS.md](../../AGENTS.md) and [ADR 0010](../adr/0010-fail-fast-environment-configuration.md) require each service to stop at boot when a required variable is missing, and forbid `process.env.VAR ?? "default"` in bootstrap code. The gaps below remain in the tree. This RFC proposes one helper per service, a fixed required-variable list per service, a CI check against regression, and a clean cutover of every caller. It touches the seven database-owning backends, ops-console-service, identity-service's email and secret handling, both web images, Compose, `.env.example`, and `deploy/aws`.

## Motivation

| # | Gap | Location |
|---|---|---|
| 1 | `DATABASE_URL` optional. `createXDatabase()` returns `undefined`; 20 `database ?` branches answer 503 or report health without a DB | `apps/{catalog,identity,inventory,operations-query,payment,sales}-service/src/shared/infrastructure/database.ts:8-11`; `catalog-service/src/main.ts:131` returns `ok` from `/health/ready` regardless |
| 2 | Drizzle config falls back to the admin role with `change_this_password` on localhost | `apps/{catalog,chatbot,identity,inventory,operations-query,payment,sales}-service/drizzle.config.ts:9-10` |
| 3 | `LOG_LEVEL ?? "info"`; chatbot and ops-console hard-code `"info"` | `logger.ts:21` (six services); `chatbot-service` and `ops-console-service` `src/logger.ts`; `logger.test.ts:11` |
| 4 | `EMAIL_PROVIDER` defaults from `NODE_ENV`; unknown values silently become SMTP; `log` writes the single-use `token` to logs | `identity-service/src/bootstrap/dependencies.ts:78-84`; `verification-email-sender.ts:14,89-94` |
| 5 | No `API_BASE_URL`: the web image starts and answers 502 | `apps/nginx-entrypoint.sh:4,48`, copied by `apps/Dockerfile.web` to `40-api-proxy.sh` |
| 6 | Dev proxy silently skipped without `API_BASE_URL` | `apps/{customer,staff}-web/vite.config.ts:8` |
| 7 | Identity signing secret unchecked at boot; `/api/auth/context` fails later with 503 | `identity-service/src/modules/accounts/presentation/http/account-routes.ts:114-117` |
| 8 | Trusted-request middleware reads secrets from `process.env` per request | `identity-service/src/middleware/trusted-request.ts:379-381`, same in each service |
| 9 | SePay settings read per payment, not at boot | `payment-service/src/modules/payment-repository.ts:398-413` |
| 10 | `RETAIL_STORE_COORDINATES_JSON ?? "[]"`, malformed JSON only warned; ORS base URL defaulted in client | `sales-service/src/main.ts:105,111-113`; `open-route-service-client.ts:11,13` |
| 11 | Chatbot "no adapter": env path fails at boot (`ai-provider-config.ts:46-48`); a stored unsupported provider fails on first call (`ai-adapters.ts:21-24`, vault `current()` unchecked). Catalog and sales `ai-adapters.ts:13` have no guard | ADR 0009 line 31 says `typesafe` for the chatbot passes startup; with `AI_CHATBOT_PROVIDER=typesafe` it does not |
| 12 | Compose anchor gives the admin login to every backend (`DATABASE_USER`/`DATABASE_PASSWORD`, unused). Root `.env.example:74` holds a catalog `DATABASE_URL` that `--env-file=../../.env` (every `dev` script, identity `seed`) hands to all services; `seed.mjs:17-21` reads host and port from it | `docker-compose.yml:25-28`; `.env.example:74`; `apps/*/package.json` |
| 13 | Required by code, absent from `.env.example`: `LOG_LEVEL`, `PROMETHEUS_URL`, `RABBITMQ_MANAGEMENT_*`, four probe URLs | `apps/ops-console-service/src/modules/system/probed-services.ts:8-50` |
| 14 | Containers get `NODE_ENV: development` (`docker-compose.yml:26`), so they use SMTP only by fallback. AWS sets `NODE_ENV=production` (`deploy/aws/main.tf:569,646`), no provider, and no `RESEND_API_KEY` | `deploy/aws` |
| 15 | CI validates Compose with no `.env` and runs no configuration check | `.github/workflows/ci.yml` |

Already right, and the pattern to copy: chatbot requires `DATABASE_URL` (`chatbot-service/src/main.ts:41`); search-service config has no defaults; all seven `DATABASE_URL`s are in Compose (`docker-compose.yml:364-610`) and `deploy/aws/terraform.tfvars.example:108-132`.

## Goals

- A missing or invalid variable stops its service at boot, and the error names it, for every service in the table below.
- No `??` or `||` env default remains in bootstrap code, `drizzle.config.ts`, `migrate.ts`, the nginx entrypoint, or the Vite serve path; CI enforces it.
- A filled copy of `.env.example` boots the stack with no other change.

## Non-goals

- No change to the AI settings model (ADR 0009), its all-or-none groups, or any HTTP contract.
- No zod config rewrite and no `packages/config` library (see Alternatives).
- No change to readiness semantics beyond deleting the no-database branches. No change to search-service or to AWS resources beyond environment entries.

## Proposed design

### Shared pattern

- Each Node service gets `src/shared/infrastructure/environment.ts`, copied from catalog-service's existing file (`requiredEnvironmentVariable`, `requiredEnvironmentSecret` with `$$` unwrapping), plus `optionalEnvironmentVariable` (empty means unset) and `requiredPositiveIntegerEnvironmentVariable`, moved from `identity-service/src/bootstrap/dependencies.ts:51` and used for `DELIVERY_*` too, so `NaN` cannot pass.
- All required reads sit in one block at the top of `main.ts`, after the telemetry import and before any client or socket opens. Local `requireEnv` copies are deleted.
- Messages stay `Missing required environment variable: NAME. Please set it in your .env file.` Enumerated values are validated: `LOG_LEVEL` against pino levels, `EMAIL_PROVIDER` against `smtp` and `resend`.

### Required variables per service

"New" means not checked at boot today.

| Service | Required at boot (existing) | New |
|---|---|---|
| identity | PORT, RABBITMQ_URL, TRUST_PROXY_HOPS, REDIS_URL, AUTH_RATE_LIMIT_*, EMAIL_FROM, PUBLIC_APP_URL, SMTP_*, ARGON2_*, OTEL endpoint | DATABASE_URL, INTERNAL_IDENTITY_SECRET, EMAIL_PROVIDER, RESEND_API_KEY (when `resend`), LOG_LEVEL |
| catalog | PORT, RABBITMQ_URL, TYPESENSE_*, SEAWEEDFS_* (5), INTERNAL_IDENTITY_SECRET, AI embedding group | DATABASE_URL, SECRETS_ENCRYPTION_KEY (now unconditional), LOG_LEVEL |
| inventory | PORT, CATALOG_SERVICE_URL, INTERNAL_SERVICE_SECRET, RABBITMQ_URL | DATABASE_URL, INTERNAL_IDENTITY_SECRET, LOG_LEVEL |
| sales | PORT, INTERNAL_IDENTITY_SECRET, INTERNAL_SERVICE_SECRET, CATALOG/INVENTORY/IDENTITY_SERVICE_URL, RABBITMQ_URL, VIETMAP_*, AI prescription-reader group | DATABASE_URL, SECRETS_ENCRYPTION_KEY, LOG_LEVEL; if `OPENROUTESERVICE_API_KEY` is set, also its base URL and `DELIVERY_*` |
| payment | PORT, SEPAY_WEBHOOK_SECRET, SALES/CATALOG_SERVICE_URL, INTERNAL_SERVICE_SECRET, RABBITMQ_URL | DATABASE_URL, INTERNAL_IDENTITY_SECRET, LOG_LEVEL, `PHARMACY_PAYMENT_SEPAY_BANK`, `_ACCOUNT_NUMBER`, `_QR_BASE_URL` (moved from request time) |
| operations-query | PORT, CATALOG/INVENTORY/SALES_SERVICE_URL, INTERNAL_SERVICE_SECRET, RABBITMQ_URL | DATABASE_URL, INTERNAL_IDENTITY_SECRET, LOG_LEVEL |
| chatbot | PORT, DATABASE_URL, INTERNAL_IDENTITY_SECRET, SECRETS_ENCRYPTION_KEY, CATALOG_SERVICE_URL, AI groups (all-or-none, may be absent) | LOG_LEVEL |
| ops-console | PORT, PROMETHEUS_URL, RABBITMQ_MANAGEMENT_*, TYPESENSE_*, INTERNAL_IDENTITY_SECRET, GRAFANA_PUBLIC_URL, eight `*_SERVICE_URL` probes | LOG_LEVEL; add missing keys to `.env.example` |
| customer-web, staff-web | `API_BASE_URL` at container start and at `vite serve` | both |

Optional, empty means unset, documented in `.env.example`: `OPENROUTESERVICE_API_KEY` (absent: no delivery calculator), `REDIS_URL` (absent: in-memory cache; photo intake answers 503 per [ADR 0005](../adr/0005-opaque-sessions-and-csrf.md)), `RETAIL_STORE_COORDINATES_JSON` (absent: none; malformed: boot error), `GOOGLE_CLIENT_ID`/`_SECRET` (both or neither).

### Decisions: LOG_LEVEL, EMAIL_PROVIDER, adapters

- **LOG_LEVEL is required** in all eight Node services. An "optional" setting needs `?? "info"` or pino's built-in silent default, which is the pattern the rule forbids. Cost: one line in each `.env`. Tests set it through `test.env` in each `vitest.config.ts`, which is test configuration, not bootstrap.
- **EMAIL_PROVIDER is required**: `smtp` (Mailpit locally) or `resend`. Delete the `log` branch and `LoggingVerificationEmailSender`, whose only caller is `dependencies.ts`. Read `RESEND_API_KEY` only for `resend`.
- **Stored AI rows do not exit at boot.** The credential routes live in the same process, so exiting would block the fix. Readiness is not the answer either: the ALB health-check path defaults to `/health/ready` (`deploy/aws/main.tf:429`), so a 503 would drain the repair route. Catalog, sales and chatbot share chatbot's explicit guard (`ai-adapters.ts:21-24`), and the vault logs one error at boot per stored unsupported provider.

### Database and migrations

- `createXDatabase(connectionString: string)` takes a required argument. Delete the `process.env` default, the `undefined` return, the 20 `database ?` branches, and catalog's 503 `search-credential` branch.
- `drizzle.config.ts` (seven) throws with the standard message when `DATABASE_URL` is unset. The throw is inline because drizzle-kit does not import from `src`. `db:generate` then also needs `DATABASE_URL`.
- `migrate.ts` (seven): delete `DRIZZLE_MIGRATIONS_DIR ?? ...`; nothing in the repo sets it.
- `tools/migrate-all.mjs` stays the documented path: it sets `DATABASE_URL` per service from `<SVC>_DB_PASSWORD` and `POSTGRES_PORT`, overriding the root `.env`. Only its error text changes. Bypass runs (`pnpm --dir apps/<svc> db:migrate`) need `DATABASE_URL` exported; the repo's configs and scripts load no env file.
- Delete root `DATABASE_URL` from `.env.example`. `seed.mjs` builds host and port from `localhost:${POSTGRES_PORT}`, as `migrate-all.mjs` does.

### Web, Compose, `.env.example`, AWS

- `apps/nginx-entrypoint.sh`: when `API_BASE_URL` is empty, print the requirement to stderr and `exit 1`; the 502 branch goes. The official `docker-entrypoint.sh` runs with `set -e` and executes each `*.sh` (read from the nginx source; the smoke test confirms it).
- Vite configs require `apiBaseUrl` only when `command === "serve"` (dev and preview), mirroring `servePort()`. `vite build` stays env-free.
- `docker-compose.yml`: delete lines 27-28; add `LOG_LEVEL: ${LOG_LEVEL}` to the anchor and `EMAIL_PROVIDER: ${EMAIL_PROVIDER}` to identity. Bare references only.
- `.env.example`: add `LOG_LEVEL=info`, the ops-console keys, and empty `RESEND_API_KEY=` and `RETAIL_STORE_COORDINATES_JSON=` with comments; delete line 74.
- `deploy/aws/main.tf` `local.task_environment` (line 153): `EMAIL_PROVIDER = "resend"` for identity; `LOG_LEVEL` for all backends. Secrets go in the maps described in [deploy/aws/README.md](../../deploy/aws/README.md).

### Enforcement: `tools/env-contract.mjs`

A new script of about 80 lines, run in CI and by developers as `node tools/env-contract.mjs --env .env`. It fails when: (1) a non-test `apps/*/src`, `drizzle.config.ts` or `apps/*/*.mjs` file has `process.env.NAME ??` or `||` (allow-list: `vite.config.ts`); (2) a name passed to a required helper or a `urlVariable` is missing from `.env.example` or from `--env`; (3) `docker-compose.yml` has `:-` or a `${VAR}` that `.env.example` lacks.

### Contracts

- No HTTP route, request, response, or event change. `/api/auth/context` loses its 503 `identity_unconfigured` path because the secret is checked at boot.

### Data model and events

- None: no schema, migration, outbox, or integration event change.

### Security and CSRF

- No new endpoint or CSRF surface. Removing `log` stops writing single-use verification and reset tokens to logs (`EmailInput.token`). Removing `DATABASE_USER`/`DATABASE_PASSWORD` stops giving the admin password to every backend container. New AWS secrets go only in Secrets Manager maps.

### Observability

- Failures appear as boot exit codes and log lines; no new metrics. Add a "Configuration failures" entry to [runbook Troubleshooting](../runbook.md#troubleshooting). Readiness is unchanged (open question 4).

## Alternatives considered

- **Shared `packages/config`.** One implementation, rejected for now: a workspace package and a Docker build input for about 20 lines, and the repo already copies such helpers. Revisit if copies drift.
- **Zod `config.ts` per service.** Reports every missing name at once and is typed. Better long-term; rejected here because it rewrites every bootstrap, against the surgical-edit rule. Candidate follow-up.
- **Optional DB, routes answer 503.** Rejected: catalog reports `ok` with no DB (`main.ts:131`), so misconfiguration looks like a partial outage.
- **Optional `LOG_LEVEL` with pino's default.** Rejected: an implicit default.
- **Keep the `NODE_ENV` provider switch with a warning.** Rejected: the provider would change silently with the Compose anchor.

## Rollout and migration

1. Configuration surface first, no behavior change: `.env.example`, Compose, `deploy/aws/main.tf`, and real Secrets Manager values (open question 1) before step 3.
2. Helper, `env-contract`, CI. In `ci.yml` add `node tools/env-contract.mjs`; replace the bare compose check with `docker compose --env-file .env.example config --quiet` failing when its output contains `variable is not set`.
3. Service code per the table: DB required (seven), `LOG_LEVEL` (eight), `EMAIL_PROVIDER`, identity secret, payment boot reads, sales optionals, ORS default removed, trusted-middleware env reads removed, adapter guards aligned.
4. Drizzle configs, `migrate.ts`, `migrate-all.mjs` text, `seed.mjs`, root `DATABASE_URL` removed. Nginx entrypoint and Vite configs.
5. Delete dead code: `DRIZZLE_MIGRATIONS_DIR`, `LoggingVerificationEmailSender`, `INTERNAL_IDENTITY_AUDIENCE`, the ORS default, the RETAIL try/catch, `database ?` branches.
6. Docs: [runbook](../runbook.md) (Run migrations, Database roles, Troubleshooting), CHANGELOG under `Unreleased`, and a new ADR for the decision; point ADR 0010's deviation list and ADR 0009 line 31 to it.

AWS: identity's task needs `EMAIL_PROVIDER` and `RESEND_API_KEY` before the new image, or identity fails at boot; payment's task needs the three `PHARMACY_PAYMENT_SEPAY_*` values first, or it crash-loops. Deploy identity first, since the authorizer depends on it. Rollback: revert each task revision; added variables are harmless.

Risk to `pnpm dev`: a `.env` without the new keys fails at boot and names the key (`env-contract --env .env` lists them). Bypass runs fail clearly instead of using the catalog database. `.env.dev` files do not change. Existing `.env` copies can delete the root `DATABASE_URL` line.

Risk to the container stack: low, since all seven `DATABASE_URL`s exist. Rebuild with `pnpm run stack:up`, which passes `--build`.

## Testing

- Unit (Vitest, `src/shared/infrastructure/environment.test.ts`): required, empty, optional and integer cases, following `internal-service-headers.test.ts:44-47`. Existing `vitest.config.ts` files get `test.env` with fixed non-secret values (`LOG_LEVEL: "silent"`).
- Startup (Vitest, `src/startup.test.ts`, per service): spawn `node --experimental-transform-types src/main.ts` with a complete env minus one required name; expect exit 1 and stderr naming it. Build the env inside the test so a developer `.env` cannot leak in. Also cover `LOG_LEVEL=loud`, `EMAIL_PROVIDER=Resend`, a lone `GOOGLE_CLIENT_ID`, and an ORS key without its base URL. Positive boot needs PostgreSQL, so the stack smoke test covers it.
- Drizzle: load the config with `DATABASE_URL` unset; expect exit 1. Vite: `src/vite-config.test.ts` in both web apps: `serve` without `API_BASE_URL` throws, `build` does not.
- Main agent, after all subagents land: `pnpm run fmt:check`, `sync:check`, `typecheck`, `lint`, `build`, `pnpm test`, `git diff --check`; `node tools/env-contract.mjs`; the compose check above; `pnpm run db:migrate`; `pnpm run stack:up`, then `docker compose ps` all healthy (catalog's health passes without a DB, so health alone is not proof).
- Smoke: `curl -fsS http://localhost:8080/api/sites` returns JSON; `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/auth/me` returns 401.
- Fail-fast on rebuilt images with `--no-deps`: `docker compose run --rm --no-deps -e DATABASE_URL= catalog-service node dist/main.js` (exit 1, names it); `-e EMAIL_PROVIDER=log identity-service node dist/main.js` (exit 1); `-e API_BASE_URL= customer-web nginx -g "daemon off;"` (non-zero, with the message).
- Shell without `DATABASE_URL`: `pnpm --dir apps/sales-service db:migrate` fails naming it. `pnpm --dir apps/identity-service seed` with the root `.env` succeeds.

## Open questions

1. Real AWS tfvars (not in the repo): are `RESEND_API_KEY`, identity's `INTERNAL_IDENTITY_SECRET`, and `PHARMACY_PAYMENT_SEPAY_*` set? Owner: deploy owner. Blocks rollout step 3 for identity and payment.
2. Copies of the helper, or `packages/config`? Owner: maintainers, before step 2.
3. Should `db:generate` need `DATABASE_URL`? Proposed yes. Owner: maintainers.
4. Should readiness check the database, and should an unsupported stored AI provider surface beyond logs, for example in the credential view? Catalog always returns 200; identity and sales only check presence. Owners: ops and chatbot.
5. Is a silently disabled delivery fee without `OPENROUTESERVICE_API_KEY` intended in production? Owner: product.
6. Does any deployment use `RETAIL_STORE_COORDINATES_JSON`? Nothing in the repo sets it; if unused, delete it. Owner: sales.
7. Compose passes no `GOOGLE_*`, so Google sign-in never runs in the container stack. Intended? Owner: identity.

## Related ADRs

- [0010](../adr/0010-fail-fast-environment-configuration.md): primary; this closes its deviation list. [0002](../adr/0002-service-owned-databases.md): migrations, roles, drizzle fallback.
- [0009](../adr/0009-ai-feature-settings-in-database.md): adapter rule; line 31 needs correcting. [0005](../adr/0005-opaque-sessions-and-csrf.md): fail-closed Redis limits.
- [0006](../adr/0006-edge-identity-context.md): `INTERNAL_IDENTITY_SECRET`. [0007](../adr/0007-gateway-path-routing-and-two-topologies.md): Compose and AWS topologies. [0012](../adr/0012-local-development-modes-and-named-urls.md): `.env.dev` and bypass runs.

Business rules: BR-AUTH-008 (trusted context), BR-USER-009 (verified email before sign-in, which depends on `EMAIL_PROVIDER`), BR-PAY-005 (the payment code carried in the SePay QR). Runbook: [Database roles](../runbook.md#database-roles), [Run migrations](../runbook.md#run-migrations), [Identity rate limits](../runbook.md#identity-rate-limits-and-client-address), [Rollback and deployment](../runbook.md#rollback-and-deployment). API: [API guide](../api-guide.md), no contract changes.
