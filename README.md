# Pharmacy Central

Pharmacy Central is a Node.js 24 pharmacy platform split into an Express 5 microservices monorepo. It supports customer catalog and checkout flows, staff operations, purchasing, inventory, counter sales, prescriptions, payments, reporting, finance reconciliation, audit projections, and role-scoped access.

## Architecture

- AWS API Gateway HTTP API manages public `/api` routes, CORS and `Authorization` header forwarding (every service verifies the ES256 JWT access token against the identity-service JWKS), and routing through VPC Link and an internal Application Load Balancer to ECS Fargate backend services. The AWS configuration under `deploy/aws` is configuration-only. Local Compose retains a development-only Nginx gateway for the same path map.
- `apps/identity-service`: customer and employee accounts, ES256 JWT access tokens (one day, no sessions) and JWKS, password security, verification, and Google OIDC.
- `apps/catalog-service`: products, units, suppliers, prices, retail sites, PostGIS coordinates, and availability projections. It also owns the product search index that `search-service` reads.
- `apps/search-service`: Go read path of `GET /api/products` (the product list only). It answers from the Typesense index, falls back to `catalog-service` when Typesense is unavailable, and never reads PostgreSQL.
- `apps/inventory-service`: batches, quality, FEFO reservations, movements, transfers, returns, replenishment, stocktakes, purchase orders, goods receipts, and availability events.
- `apps/sales-service`: customer carts, orders, prescriptions, counter transactions, delivery calculation, and order events.
- `apps/payment-service`: provider-neutral invoices, QR attempts, cash payments, SePay webhooks, refunds, and reconciliation.
- `apps/operations-query-service`: RabbitMQ-fed dashboard, finance, and audit projections.
- `apps/chatbot-service`: customer consultation assistant. It keeps chat sessions and answers grounded in the catalog through HTTP tool calls to `catalog-service`, using Gemini or an OpenAI-compatible chat API.
- `apps/ops-console-service`: read-only backend of the staff-web System page (Platform Admin only). It reads service health, Prometheus, the RabbitMQ management API and Typesense. It owns no database.
- `apps/customer-web` and `apps/staff-web`: independently deployable React/Vite applications.
- `packages/`: only stable technical packages and versioned transport contracts: `auth` (ES256 access-token signing and verification), `cache`, and `ui`.

PostgreSQL/PostGIS stores are service-owned databases. RabbitMQ carries integration events. Redis provides delivery caching. Typesense with a local embedder (`deploy/embedder`) powers hybrid product search. OpenTelemetry traces, metrics and logs flow to Tempo, Prometheus, Loki and Grafana. OpenRouteService supplies server-side delivery address resolution, Matrix, Directions, distance, duration, and GeoJSON route data.

## Documentation

- [Architecture](docs/architecture.md): services, boundaries, and data flow.
- [Architecture diagrams](docs/diagrams/README.md): LikeC4 model (`pnpm diagrams:serve`).
- [Runbook](docs/runbook.md): operating steps, named URLs, and troubleshooting.
- [API Guide](docs/api-guide.md): HTTP API reference.
- [User Guide](docs/user-guide.md): customer and staff workflows.
- [Demo walkthrough](docs/demo-walkthrough.md): a per-role script for presenting the demo dataset, and `pnpm run demo:reset` to date it today.
- [Business rules](docs/business-rules.md): domain rules (in Vietnamese; rule IDs `BR-*` are stable).
- [Product specs](docs/product/README.md): what each page or user-facing feature contains, for whom, and why.
- [ADRs](docs/adr/README.md): recorded architecture decisions.
- [Design docs](docs/design/README.md): specs written before large work.
- [Contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md), [security policy](SECURITY.md).
- [Agent instructions](AGENTS.md).

## Ownership

Code owners are listed in `.github/CODEOWNERS` (currently `@nielpattin`).
The license is in `LICENSE`: all rights reserved.

## Prerequisites

- Node.js `24.19.0`, within `>=24.16.0 <25`.
- pnpm `12.3.4`.
- Go `1.26` or newer, for building, testing, and running `apps/search-service` locally. Docker builds need no local Go.
- Docker Desktop with the Linux engine enabled for local infrastructure and image builds.

Install dependencies without changing the lockfile:

```bash
pnpm install --frozen-lockfile
```

## Local development

For local development, copy `.env.example` to `.env` and start the local gateway with the web applications:

```bash
cp .env.example .env
docker compose up -d --build
```

Run `pnpm run auth:keygen` and replace the three `ACCESS_TOKEN_*` placeholders in `.env` with its output before the first start; identity-service refuses to start without them.

The Compose web containers proxy `/api` requests through the local Nginx gateway. AWS deployment configuration is separate and remains configuration-only until provisioned.

Run `pnpm run urls:up` once per session to get the named URLs (see Named local URLs in `docs/runbook.md`). Use them rather than `localhost`: the customer and staff apps then live in separate browser origins, each with its own stored token.

The default endpoints are:

- Customer web: `http://customer.pharmacy.localhost` (or `http://localhost:5301`)
- Staff web: `http://staff.pharmacy.localhost` (or `http://localhost:5302`)
- API gateway: `http://api.pharmacy.localhost` (or `http://localhost:8080`)
- Architecture diagrams (`pnpm diagrams:serve`): `http://localhost:5303`
- Grafana: `http://localhost:3030` (`GRAFANA_PORT`)
- RabbitMQ management: `http://localhost:15672`
- Mailpit: `http://localhost:8025`

For local source development, build the workspace and run service `dist/main.js` processes with the environment values from `.env.example`.

## Migrations and seeds

Each service owns its Drizzle migrations. Docker applies them before starting each service. For local source development, run them in dependency order:

```bash
pnpm --dir apps/identity-service db:migrate
pnpm --dir apps/catalog-service db:migrate
pnpm --dir apps/inventory-service db:migrate
pnpm --dir apps/sales-service db:migrate
pnpm --dir apps/payment-service db:migrate
pnpm --dir apps/operations-query-service db:migrate
pnpm --dir apps/chatbot-service db:migrate
```

Two seeds, kept separate. Demo credentials are documented in `docs/runbook.md` and are for local use only.

**A. Default seed.** Exactly one account, the Platform Admin, with the password from `ADMIN_PASSWORD` in `.env`. Nothing else. Safe to run on every start and release:

```bash
pnpm run seed:default
```

**B. Demo and reference dataset** (opt-in, development only). Run it after A. It loads the product images, sites, demo accounts (two managers, pharmacist, warehouse staff, shoppers), warehouses, suppliers, products with their units, opening balances and search synonyms:

```bash
# Fixtures live in data/. They are sample CSVs and a folder of product images. Needs the stack or `pnpm dev` running.
pnpm run seed:demo

# Before a presentation: wipes the service databases and seeds again, so every date in the dataset is relative to today.
pnpm run demo:reset
```

Staff users import CSV files from the Data import screen in `staff-web`, which generates a header-only CSV
template in the browser, previews the parsed rows, and reads the imported records back from the owning
service. Master data belongs to the service that owns it (catalog and inventory databases, images in
Floci/S3). See `data/README.md` for what is committed and what stays local.

## Verification

```bash
pnpm run fmt:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
```

Load tests use k6 in Docker and can target the local stack (`pnpm run local:up`) or the deployed one (set `LOAD_TARGET_URL`). Fault injection runs against the deployed stack. Both are described in `docs/runbook.md`:

```bash
pnpm run load -e PROFILE=smoke /scripts/scenarios/checkout.js   # k6 in Docker, results in Grafana
pnpm run chaos:aws typesense-outage                             # one fault under load on the AWS stack
```

## Run it: local and cloud

Two commands each. Run the first once, the second whenever you want fresh sample data (its dates are relative to the day it runs, so do it on the day you present).

| Where | Commands |
| --- | --- |
| Local | `pnpm run local:up`, then `pnpm run demo:reset` |
| Cloud (AWS) | `pnpm run cloud:deploy`, then `pnpm run cloud:reset --yes` |

Everything else, when you need it:

| Command | What it does |
| --- | --- |
| `pnpm run local:down` | Stops the app containers and goes back to dev mode. |
| `pnpm run cloud:deploy:fresh` | First deploy of a brand new stack: infrastructure, databases, services and data. |
| `pnpm run cloud:seed` | Adds the sample data to the running AWS stack without wiping it. |
| `pnpm run cloud:pause` | Stops RDS and removes what bills by the hour (NAT, load balancers, ElastiCache, services, DNS). Data stays; `cloud:deploy` brings it back. |
| `pnpm run cloud:destroy` | Deletes everything, database included (asks you to type `destroy`). |

`cloud:deploy` deploys the latest version tag (`git tag vX.Y.Z && git push origin vX.Y.Z` makes GitHub build its images). It builds nothing on your machine.

Local URLs: customer http://localhost:5301, staff http://localhost:5302. Cloud URLs come from the Terraform `web` output (`shop.` and `staff.` on the configured domain).

## Configuration and deployment

Copy `.env.example` to a local environment file and replace development secrets. Do not reuse demo secrets in production. Container startup runs `node dist/migrate.js` before `node dist/main.js`, and production deploys immutable digest-addressed GHCR images to ECS Fargate.

AWS deployment configuration is located under `deploy/aws`, defining AWS API Gateway HTTP API, VPC Link, internal Application Load Balancer, ECS Fargate services with Application Auto Scaling, and Grafana on Fargate with a CloudWatch dashboard. This AWS configuration is configuration-only and no AWS resources were deployed.

GitHub Actions validates affected projects on pull requests and on demand through the `Workspace validation` workflow. Releases run on demand through the `Release application images` workflow, which validates the workspace and publishes digest-addressed GHCR application images for the requested version.
