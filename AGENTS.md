# Pharmacy Central Repository Instructions

## Overview

Pharmacy Central is an Express 5 TypeScript microservices monorepo managed with pnpm and Nx.

- Runtime: Node.js 24 and Express 5, plus Go 1.26+ for `search-service` (see the Search service section).
- Database: PostgreSQL 18 with PostGIS and Drizzle ORM.
- Messaging, cache, and search: RabbitMQ 4, Redis, and Typesense.
- Frontends: React and Vite single-page applications (`customer-web` and `staff-web`).
- Tooling: Vitest, Oxlint, and Oxfmt.

## Non-negotiable rules

- Do not commit, push, pull, publish, release, or mutate Git history unless explicitly requested.
- Keep `PLAN.md` untracked, unstaged, and uncommitted.
- Do not add fallback defaults for environment variables in service code or Compose files.
- Keep edits surgical. Preserve existing routes, request contracts, and response contracts.
- Do not claim container validation passed without verifying healthy container statuses.
- Treat external registry, Docker engine, or container health failures as infrastructure issues.

## Repository layout

```text
apps/
  identity-service/         # Authentication, users, sessions, Google OIDC
  catalog-service/          # Products, units, sites, suppliers, pricing
  search-service/           # Product search read path in Go: GET /api/products from Typesense, falls back to catalog-service
  inventory-service/        # Stock, batches, movements, procurement
  sales-service/            # Orders, carts, prescriptions, delivery calculation
  payment-service/          # Invoices, payments, SePay webhook processing
  operations-query-service/ # Read models, dashboards, operational reports
  chatbot-service/          # Customer consultation assistant: catalog-grounded answers through Gemini or an OpenAI-compatible chat API
  ops-console-service/      # Read-only backend of the staff-web System page (Platform Admin only): service health, Prometheus, RabbitMQ queues, Typesense; no database
  customer-web/             # Customer-facing shopping web application
  staff-web/                # Internal pharmacy management web portal
deploy/
  aws/                      # Terraform for ECS Fargate, ALB, and API Gateway
  local/                    # Local PostgreSQL init scripts, OTel config, API gateway
tools/                      # Workspace automation scripts (migrations, links)
packages/ui/                 # Shared Tailwind theme plus Button, Input, Card, Table, Dialog (used by both webs)
```

## Architecture and service boundaries

- Applications must not import code from other applications.
- Microservices own their transport contracts under `src/contracts/`.
- Each business service owns its database schema, migrations, write models, and outbox records.
- `search-service` owns no database. It reads only Typesense, never PostgreSQL.
- `operations-query-service` reads data only through integration events emitted over RabbitMQ.
- Client input is never authoritative for prices, stock quantities, delivery fees, or identity.
- Browser mutating requests require a valid CSRF token, except for the HMAC-verified SePay webhook.

## Search service (Go)

- `apps/search-service` is a Go service with no database. It serves `GET /api/products` (the product list) on port 3009 and nothing else; every other `/api/products*` path stays on `catalog-service`.
- It reads only Typesense, never PostgreSQL. When Typesense is down, slow, or lacks the collection, it proxies the original request to `CATALOG_SERVICE_URL`.
- Its Nx project `@pharmacy/search-service` wraps the Go toolchain with `project.json` `run-commands` targets (`build`, `typecheck`, `lint`, `test`, `dev`). The root `build`, `typecheck`, `lint`, `test`, and `dev` scripts include it through `nx run-many --all`.
- Local build, lint, test, and dev of that project need Go 1.26 or newer on the `PATH`. Docker builds need no local Go.

## Configuration and environment variables

- All runtime configuration is driven strictly by `.env` (seeded from `.env.example`), except the settings of AI features. A Platform Admin sets each feature's provider, model, base URL and API key in staff-web (AI integrations), so they can change without a redeploy. Each owning service (`chatbot-service`, `sales-service`, `catalog-service`) stores those settings in `ai_credentials`, with the key sealed by `SECRETS_ENCRYPTION_KEY`. Each feature can also read `AI_<FEATURE>_PROVIDER`, `_MODEL`, `_BASE_URL` and `_API_KEY` from `.env`, where `<FEATURE>` is the feature's `purpose` in `ai_credentials` (`CHATBOT`, `PRESCRIPTION_READER`, `EMBEDDING`, `INTENT_GATE`). The four variables are all or none. Saved settings win as a whole, then the environment group is used as a whole. A feature with neither answers 503 or degrades, and the service still starts. A partial group, or a provider with no adapter, stops the service at startup.
- Services must fail fast on startup with clear errors when required environment variables are missing.
- Do not use fallback values like `process.env.VAR ?? "default"` in service bootstrap code.
- Do not use `${VAR:-default}` fallbacks in `docker-compose.yml`.
- `search-service` has no database, so it reads its `AI_EMBEDDING_*` group from its own environment and cannot see the settings saved in staff-web. Keep its four values equal to those of `catalog-service`.

## Deployment targets and routing

The system supports two runtime topologies sharing the same Docker images and contracts:

### 1. Local Docker Compose

- Provisions backing infrastructure: PostgreSQL, RabbitMQ, Redis, Typesense, Mailpit, the OTel collector, and SeaweedFS.
- `pnpm run infra:up` starts that infra plus `gateway-dev`; `pnpm run infra:down` stops everything, `gateway-dev` included.
- `pnpm run stack:up` switches to the full container stack (stops `gateway-dev`, rebuilds, waits until healthy); `pnpm run stack:down` switches back to dev mode.
- `pnpm dev` runs every app in dev mode through Nx (`nx run-many -t dev --all`): services with `node --experimental-transform-types --watch` and both webs with Vite HMR. The flag is set in each service's own `dev` script because Node's strip-only TypeScript mode rejects the parameter properties they use. Nx loads `apps/<svc>-service/.env.dev` for the `dev` target, so each service gets its own port and `DATABASE_URL`; running `pnpm --dir apps/<app> dev` bypasses Nx and skips it.
- Host port mappings and credentials load directly from the root `.env` file.

### 2. Local API gateway (Compose only)

- Two local Nginx services in `docker-compose.yml` split `/api/...` across backends like the ALB does: `gateway` forwards to the app containers, and `gateway-dev` (profile `dev`, host networking, upstreams on `127.0.0.1:${<SVC>_PORT}`) forwards to the apps that `pnpm dev` runs on the host. Both are dev-only and never run in production.
- Both share `GATEWAY_PORT` (8080), so only one runs at a time, and both include `deploy/local/gateway/routes.conf`, so path rules are edited in one place.
- Web clients and Vite `dev` proxy send `/api/...` to the gateway. Set `API_BASE_URL=http://localhost:8080` once in `.env`.
- Open the apps through the named URLs from `pnpm run urls:up` (portless, plain HTTP on port 80): `http://customer.pharmacy.localhost`, `http://staff.pharmacy.localhost`, `http://api.pharmacy.localhost`. On `localhost` the two web apps share one cookie jar and sign each other out. Do not give the web apps `localhost` URLs in browser tests.

### 2. Production (AWS ECS Fargate)

- Runs container tasks on AWS ECS Fargate defined in `deploy/aws/main.tf`.
- AWS API Gateway HTTP API and a Lambda authorizer provide edge ingress.
- An internal Application Load Balancer (ALB) routes paths to ECS services.

### Path routing map

The local gateway and AWS ALB forward traffic with identical path patterns. The `/api` prefix is stripped before forwarding:

- `/api/auth*`, `/api/admin*`, `/api/customers*` -> `identity-service:3001`
- `GET /api/products` exactly (the product list) -> `search-service:3009`
- `/api/sites*`, `/api/storage-locations*`, `/api/products*` (every other method and path under it), `/api/suppliers*`, `/api/pricing*`, `/api/stores*`, `/api/availability*` -> `catalog-service:3002`
- `/api/procurement*`, `/api/inventory*`, `/api/quality*` -> `inventory-service:3004`
- `/api/carts*`, `/api/orders*`, `/api/delivery*`, `/api/prescriptions*`, `/api/counter-transactions*` -> `sales-service:3005`
- `/api/payments*` -> `payment-service:3006`
- `/api/chatbot*` -> `chatbot-service:3008`
- `/api/system*` -> `ops-console-service:3010` (Platform Admin only)
- `/api/operations*`, `/api/dashboard*`, `/api/finance*`, `/api/audit*`, `/api/reports*` -> `operations-query-service:3007`
- Any other path, `/` included, returns a JSON 404.

## Database migrations and seeds

- Each backend service owns its Drizzle migrations under `apps/<service>/drizzle/migrations`.
- Run all service migrations with `pnpm run db:migrate` (or one service with `pnpm --dir apps/<service> db:migrate`).
- Each service connects to Postgres as its own role (`<service>_service`), which owns only its database. The `postgres-roles` Compose service creates the roles from the `<SVC>_DB_PASSWORD` variables with `deploy/local/postgres/roles.sh`; `POSTGRES_USER` is the admin account and is not used by the services.
- Only `apps/identity-service/seed.mjs` seeds data, and it seeds local login accounts only.
- Accounts are seeded only as part of `pnpm run dev:data`; there is no standalone root script for it.
- Business master data is imported through `POST /api/products/imports` and `POST /api/inventory/imports/opening-balances` or the staff-web Data import screen. The committed fixtures live in `data/` (sample CSVs in `data/import-samples/`, coursework images as the folder `data/product-images/images/`, one file per product named by SKU); `originals/`, `provenance/`, and `research/` are local only. Never serve data files from a web app and never add `data/` to a container image. `products.csv` ships a filled `imageUrl` column whose object keys are content hashes, so the images must be uploaded before importing products for those URLs to resolve; `pnpm run dev:data` does both.
- Load a local stack with `pnpm run dev:data` (development only; it needs `pnpm dev` running). It seeds the demo accounts, uploads every file in `data/product-images/images/` (named `<SKU>.<ext>`, PNG, JPEG, or WebP) to local SeaweedFS under the content-hash key `product-images/<SKU>/<sha256>.<ext>`, imports the sample CSVs through the API as the demo admin, and reseeds the accounts so staff get their site access. Last, it creates and approves the six local search synonym groups. The demo admin creates them, and the demo pharmacist approves them. Production starts with no synonym groups. Staff add them in staff-web under Search synonyms. It refuses `NODE_ENV=production` and any non-loopback `API_BASE_URL`.

## Frontend guidelines

- `customer-web` and `staff-web` are independent Vite React applications.
- Do not use direct `useEffect` in React components. Use derived state, event handlers, `useSyncExternalStore`, or `useMountEffect`.
- Web clients call `/api/...` endpoints. Vite and production Nginx proxy those calls to the configured ingress URL.
- Build all UI from `@pharmacy/ui` primitives and theme tokens (Tailwind v4). Extend the shared package instead of adding a second design system.

## Change workflow

There are two local modes (details in `docs/runbook.md`). **Ask the user which one to use at the start of every session** and keep it until they change it. Never assume, and never switch silently.

|                                | Dev mode                                                                                                   | Container mode                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| What runs                      | Infra in Docker; the six services and both webs on the host (`node --watch`, Vite HMR)                     | Everything in Docker, built from the images, closest to AWS                               |
| Start                          | `pnpm run infra:up`, then `pnpm dev` (background service; stop it when you finish unless the user runs it) | `pnpm run stack:up` (stops `gateway-dev`, rebuilds, waits until healthy)                  |
| Use it for                     | Fast iteration while coding                                                                                | Checking what ships; Dockerfile, Compose, env, dependency, migration, load and chaos work |
| Latest change is visible after | The file is saved                                                                                          | You rebuild with `pnpm run stack:up`                                                      |

Then follow the same loop in both modes:

1. **Classify the request.** If it says talk, research, suggest, or "do not edit", answer only and change nothing.
2. **Orient.** Read `docs/architecture.md`, the ADRs in `docs/adr`, any draft in `docs/design`, and the spec in `docs/product` of every page you change. Reuse the existing pattern. A big change (new service, new integration event, a schema change across services, a new external dependency) starts as a draft in `docs/design`; stop for review before building. A new page or user-facing feature, or a change to what a page contains or why, starts with its spec in `docs/product`. When an open question in that spec decides the work, ask the owner instead of guessing.
3. **Implement in small slices.** Delegate disjoint slices to sub-agents in parallel and set shared contracts (types, schema, events) first. Sub-agents only edit; they do not run gates, formatters, or commit. Build UI only from `@pharmacy/ui`, with no custom in-place styles.
4. **Run the gates once** (see Verification workflow). Use pnpm only.
5. **Run the change in the chosen mode.** After a migration change run `pnpm run db:migrate`; Compose does not run it. In container mode rebuild with `pnpm run stack:up` and confirm every container in `docker compose ps` is healthy. Run `pnpm run urls:up` once per session for the named URLs.
6. **Verify the real surface** (the `verify-pharmacy-central` skill in `.agents/skills` scripts the checks for both modes). Open the named URLs at 1920x1080 with the saved role state (see Browser testing) and exercise the changed path. For an API change, call it through `http://api.pharmacy.localhost`. Report only what you ran. Dev data is disposable: reseed with `pnpm run dev:data` instead of preserving it.
7. **Update docs in the same change.** `docs/` (user guide, API guide, runbook), `docs/product` for the spec of every page or user-facing feature you added or changed, `docs/business-rules.md` for every new or changed business rule (its section 25 requires this), the LikeC4 diagrams, `CHANGELOG.md` under Unreleased, and an ADR when you made a lasting decision.
8. **Report and stop.** Commit only when asked. When asked: split by concern, use `type(scope): summary` with a short body, amend the last commit when told to fix it, and never push.

## Verification workflow

Run all checks before finishing work:

```bash
pnpm run fmt:check
pnpm run sync:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
git diff --check
```

For Docker validation:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

### Browser testing

- Open the apps at `http://customer.pharmacy.localhost` and `http://staff.pharmacy.localhost` (run `pnpm run urls:up` first), never at `localhost`: on `localhost` the two apps share one cookie jar and sign each other out.
- Use a 16:9 viewport of 1920x1080 for every browser test and screenshot.
- Use the browser tool's default browser: `browser.open({ name, url, viewport, app: { tern: false, relay: false } })`. Never pass `app.path` or launch Edge or Chrome yourself.
- A signed-in role is a saved state file under `~/.omp/browser-profiles/<role>.json`, not a browser profile directory. Restore it with `tab.loadState(path)` on a fresh tab, then `goto` the app, and confirm `GET /api/auth/me` returns the expected email before trusting the screen. A browser holds one session per host, so one customer and one staff account can be signed in at once, but not two staff accounts:
  - `customer` -> customer-web (`khachhang@pharmacycentral.vn`)
  - `staff-admin` -> staff-web (`admin@pharmacycentral.vn`)
  - `staff-manager` -> staff-web (`manager@pharmacycentral.vn`, `SITE-RTL`)
  - `staff-pharmacist` -> staff-web (`pharmacist@pharmacycentral.vn`, `SITE-RTL`)
  - `staff-warehouse` -> staff-web (`warehouse@pharmacycentral.vn`, `SITE-WH`)
- Recreate a state file after a reseed or a password change: sign in on a clean tab (`tab.clearCookies()` first), then `tab.saveState(path)`. Clear the cookies and close the tab when done so the next role starts clean.

## Documentation map

- Read first: [Architecture](docs/architecture.md), [diagrams](docs/diagrams/README.md), [runbook](docs/runbook.md), [API Guide](docs/api-guide.md), [User Guide](docs/user-guide.md), [Business rules](docs/business-rules.md), [Contributing](CONTRIBUTING.md).
- Big work: write a design doc in [docs/design](docs/design/README.md) first.
- Pages and user-facing features: write or update the spec in [docs/product](docs/product/README.md): what the page contains, for whom, and why.
- After a decision: record an ADR in [docs/adr](docs/adr/README.md).
- Add a [CHANGELOG](CHANGELOG.md) entry under `Unreleased`.
- Keep `docs/runbook.md` and the LikeC4 diagrams in step with your changes.
