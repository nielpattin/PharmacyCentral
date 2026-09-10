# Pharmacy Central

Pharmacy Central is a Node.js 24 pharmacy platform split into an Express 5 microservices monorepo. It supports customer catalog and checkout flows, staff operations, purchasing, inventory, counter sales, prescriptions, payments, reporting, finance reconciliation, audit projections, and role-scoped access.

## Architecture

- AWS API Gateway HTTP API + Lambda authorizer manages public `/api` routes, sessions, CSRF, CORS, signed internal identity context forwarding, and routing through VPC Link and an internal Application Load Balancer to ECS Fargate backend services. The AWS configuration under `deploy/aws` is configuration-only. Local Compose retains a development-only Nginx gateway for the same path map.
- `apps/identity-service`: customer and employee accounts, opaque sessions, password security, verification, and Google OIDC.
- `apps/catalog-service`: products, units, suppliers, prices, retail sites, PostGIS coordinates, and availability projections.
- `apps/inventory-service`: batches, quality, FEFO reservations, movements, transfers, returns, replenishment, stocktakes, purchase orders, goods receipts, and availability events.
- `apps/sales-service`: guest and customer carts, orders, prescriptions, counter transactions, delivery calculation, and order events.
- `apps/payment-service`: provider-neutral invoices, QR attempts, cash payments, SePay webhooks, refunds, and reconciliation.
- `apps/operations-query-service`: RabbitMQ-fed dashboard, finance, reporting, and audit projections.
- `apps/customer-web` and `apps/staff-web`: independently deployable React/Vite applications.
- `packages/`: only stable technical packages and versioned transport contracts.

PostgreSQL/PostGIS stores are service-owned databases. RabbitMQ carries integration events. Valkey provides delivery caching. OpenRouteService supplies server-side delivery address resolution, Matrix, Directions, distance, duration, and GeoJSON route data.

## Prerequisites

- Node.js `24.19.0`, within `>=24.16.0 <25`.
- pnpm `12.3.4`.
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

The default endpoints are:

- Customer web: `http://localhost:5173`
- Staff web: `http://localhost:5174`
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

Seed all services deterministically:

```bash
pnpm run seed:demo
```

Demo credentials are documented in `docs/Runbooks.md` and are for local use only.

## Verification

```bash
pnpm run fmt:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
```


## Configuration and deployment

Copy `.env.example` to a local environment file and replace development secrets. Do not reuse demo secrets in production. Container startup runs `node dist/migrate.js` before `node dist/main.js`, and production deploys immutable digest-addressed GHCR images to ECS Fargate.

AWS deployment configuration is located under `deploy/aws`, defining AWS API Gateway HTTP API, Lambda authorizer, VPC Link, internal Application Load Balancer, and ECS Fargate services. This AWS configuration is configuration-only and no AWS resources were deployed.

GitHub Actions validates affected projects on pull requests and on demand through the `Workspace validation` workflow. Releases run on demand through the `Release application images` workflow, which validates the workspace and publishes digest-addressed GHCR application images for the requested version.

## Documentation

- [Architecture](docs/Architecture.md)
- [API Guide](docs/ApiGuide.md)
- [Dependency baseline](docs/Baseline.md)
- [Runbooks](docs/Runbooks.md)
- [Project summary](docs/ProjectSummary.md)
