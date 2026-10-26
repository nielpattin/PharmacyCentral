# 0002. Service-owned databases

Status: Accepted

Date: 2026-09-10

## Context

Each business service keeps its data in its own PostgreSQL database. The first commits of 2026-09-10 set this up:
`8e7005f` (identity) and `c494340` (sales) each added a service-local `drizzle.config.ts`, and `8f10c13` added
`tools/migrate-all.mjs`. The ownership rules are in [AGENTS.md](../../AGENTS.md) and
[architecture.md](../architecture.md#data-ownership). The reason is not recorded in the repository beyond those rules.

Until 2026-10-23 every service connected with the one admin account from `POSTGRES_USER`. Commit `0cdc8ff` changed
that, because "a leaked DATABASE_URL exposed every database".

## Decision

- Each business service owns one database (`identity_service` to `chatbot_service`), its schema, its Drizzle migrations
  under `apps/<service>/drizzle/migrations` and its write models. Every service's `db:migrate` runs `drizzle-kit migrate`.
- Each service connects as its own role, `<service>_service`. `deploy/local/postgres/roles.sh` creates the roles from the
  `<SVC>_DB_PASSWORD` variables, makes each role own its database, and revokes `CONNECT` from `PUBLIC` on it. The
  `postgres-roles` service in [docker-compose.yml](../../docker-compose.yml) runs it before any backend starts.
- Migrations run as the owning role. `tools/migrate-all.mjs` builds each URL from the same passwords. The container
  command in `apps/Dockerfile.service` runs `dist/migrate.js` before `dist/main.js`.
- No service reads or writes another service's database. Cross-service data moves through HTTP contracts in
  `src/contracts/` or through integration events (see [0003](0003-transactional-outbox-and-integration-events.md)).
- `search-service` owns no database: it reads only Typesense, and its `go.mod` has no PostgreSQL driver.
  `ops-console-service` owns no database either.

## Consequences

- A leaked `DATABASE_URL` exposes one service's data. The runbook gives this as the reason
  ([runbook.md](../runbook.md#database-roles)).
- A feature that needs another service's data needs an API or an event. It cannot join across databases.
- Known deviation: `operations-query-service` reads summary figures over HTTP from catalog, inventory and sales
  (`apps/operations-query-service/src/modules/operations-repository.ts`). architecture.md lists it as a deviation to remove.
- Role setup is not in Terraform. `deploy/aws/README.md` says the roles must be created on RDS by hand with the SQL
  that `roles.sh` runs.
- Moving ownership needs a data move. Procurement tables now belong to the inventory database, so an environment with a
  separate procurement database must copy its data first (`deploy/aws/README.md`).
- Observed in code: when `DATABASE_URL` is unset, each `apps/<service>/drizzle.config.ts` falls back to a URL built from
  `POSTGRES_USER` and `POSTGRES_PASSWORD`, with the literal defaults `pharmacycentral` and `change_this_password`. That is
  the admin account, not the service role. `tools/migrate-all.mjs` always sets `DATABASE_URL`, so the fallback matters only
  for a manual `db:migrate` run without it.

## Alternatives considered

- One admin account shared by all services, which ran until `0cdc8ff`.
