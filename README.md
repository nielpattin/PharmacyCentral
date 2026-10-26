# Pharmacy Central

Pharmacy Central is a Node.js 24 pharmacy platform split into an Express 5 microservices monorepo. It supports customer catalog and checkout flows, staff operations, purchasing, inventory, counter sales, prescriptions, payments, reporting, finance reconciliation, audit projections, and role-scoped access.

## Architecture

- AWS API Gateway HTTP API + Lambda authorizer manages public `/api` routes, sessions, CSRF, CORS, signed internal identity context forwarding, and routing through VPC Link and an internal Application Load Balancer to ECS Fargate backend services. The AWS configuration under `deploy/aws` is configuration-only. Local Compose retains a development-only Nginx gateway for the same path map.
- `apps/identity-service`: customer and employee accounts, opaque sessions, password security, verification, and Google OIDC.
- `apps/catalog-service`: products, units, suppliers, prices, retail sites, PostGIS coordinates, and availability projections. It also owns the product search index that `search-service` reads.
- `apps/search-service`: Go read path of `GET /api/products` (the product list only). It answers from the Typesense index, falls back to `catalog-service` when Typesense is unavailable, and never reads PostgreSQL.
- `apps/inventory-service`: batches, quality, FEFO reservations, movements, transfers, returns, replenishment, stocktakes, purchase orders, goods receipts, and availability events.
- `apps/sales-service`: guest and customer carts, orders, prescriptions, counter transactions, delivery calculation, and order events.
- `apps/payment-service`: provider-neutral invoices, QR attempts, cash payments, SePay webhooks, refunds, and reconciliation.
- `apps/operations-query-service`: RabbitMQ-fed dashboard, finance, reporting, and audit projections.
- `apps/ops-console-service`: read-only backend of the staff-web System page (Platform Admin only). It reads service health, Prometheus, the RabbitMQ management API and Typesense. It owns no database.
- `apps/customer-web` and `apps/staff-web`: independently deployable React/Vite applications.
- `packages/`: only stable technical packages and versioned transport contracts.

PostgreSQL/PostGIS stores are service-owned databases. RabbitMQ carries integration events. Redis provides delivery caching. OpenRouteService supplies server-side delivery address resolution, Matrix, Directions, distance, duration, and GeoJSON route data.

## Documentation

- [Architecture](docs/architecture.md): services, boundaries, and data flow.
- [Architecture diagrams](docs/diagrams/README.md): LikeC4 model (`pnpm diagrams:serve`).
- [Runbook](docs/runbook.md): operating steps, named URLs, and troubleshooting.
- [API Guide](docs/api-guide.md): HTTP API reference.
- [User Guide](docs/user-guide.md): customer and staff workflows.
- [Business rules](docs/business-rules.md): domain rules (in Vietnamese; rule IDs `BR-*` are stable).
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

The Compose web containers proxy `/api` requests through the local Nginx gateway. AWS deployment configuration is separate and remains configuration-only until provisioned.

Run `pnpm run urls:up` once per session to get the named URLs (see Named local URLs in `docs/runbook.md`). Use them rather than `localhost`: the customer and staff sessions then live in separate browser origins.

The default endpoints are:

- Customer web: `http://customer.pharmacy.localhost` (or `http://localhost:5301`)
- Staff web: `http://staff.pharmacy.localhost` (or `http://localhost:5302`)
- API gateway: `http://api.pharmacy.localhost` (or `http://localhost:8080`)
- Architecture diagrams (`pnpm diagrams:serve`): `http://localhost:5303`
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
```

Demo credentials are documented in `docs/runbook.md` and are for local use only.

Load the demo accounts, product images, and sample master data (development only):

```bash
# Fixtures live in data/. They are sample CSVs and a folder of product images. Needs `pnpm dev` running.
pnpm run dev:data
```

Staff users import CSV files from the Data import screen in `staff-web`, which generates a header-only CSV
template in the browser, previews the parsed rows, and reads the imported records back from the owning
service. Master data belongs to the service that owns it (catalog and inventory databases, images in
SeaweedFS/S3). See `data/README.md` for what is committed and what stays local.

## Verification

```bash
pnpm run fmt:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
```

Load and chaos tests run against the container stack (`pnpm run stack:up`) and are described in `docs/runbook.md`:

```bash
pnpm run load -e PROFILE=smoke /scripts/scenarios/checkout.js   # k6 in Docker, results in Grafana
pnpm run chaos rabbitmq-outage                                  # one fault under load; "all" runs every scenario
pnpm run stack:aws-like                                         # container stack sized like the ECS tasks, for capacity tests
```

## Configuration and deployment

Copy `.env.example` to a local environment file and replace development secrets. Do not reuse demo secrets in production. Container startup runs `node dist/migrate.js` before `node dist/main.js`, and production deploys immutable digest-addressed GHCR images to ECS Fargate.

AWS deployment configuration is located under `deploy/aws`, defining AWS API Gateway HTTP API, Lambda authorizer, VPC Link, internal Application Load Balancer, and ECS Fargate services. This AWS configuration is configuration-only and no AWS resources were deployed.

GitHub Actions validates affected projects on pull requests and on demand through the `Workspace validation` workflow. Releases run on demand through the `Release application images` workflow, which validates the workspace and publishes digest-addressed GHCR application images for the requested version.
