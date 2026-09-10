# Pharmacy Central Architecture

Pharmacy Central is an Express 5 microservices monorepo for customer and staff pharmacy workflows.

## Runtime topology

```text
customer-web ─┐
staff-web ─────┼── AWS API Gateway (HTTP API)
               │         │
               │    Lambda Authorizer (Session, CSRF, Signed Identity Context)
               │         │
               │      VPC Link
               │         │
               │   internal ALB (Application Load Balancer)
               │         │
               │         ├── identity-service (ECS Fargate :3001)
               │         ├── catalog-service (ECS Fargate :3002)
               │         ├── inventory-service (ECS Fargate :3004, procurement included)
               │         ├── sales-service (ECS Fargate :3005)
               │         ├── payment-service (ECS Fargate :3006)
               │         └── operations-query-service (ECS Fargate :3007)
               │
               └── PostgreSQL 18/PostGIS service databases
                   RabbitMQ, Valkey, Mailpit, OpenTelemetry Collector
```

AWS API Gateway owns the public `/api` surface with a Lambda authorizer. Traffic travels through a VPC Link to an internal Application Load Balancer, which routes to ECS Fargate backend services. The AWS configuration in `deploy/aws` is configuration-only and no AWS resources were deployed. AWS does not use the local gateway. Local Compose retains an Nginx reverse proxy for development. Business services own their write models and migrations. The operations query service consumes events and never reads another service database.

## Workspace boundaries

- `apps/identity-service` owns accounts, sessions, verification tokens, OIDC, and access data.
- `apps/catalog-service` owns sites, PostGIS coordinates, storage locations, products, suppliers, units, prices, and availability projections.
- `apps/inventory-service` owns batches, quality, balances, ledger entries, FEFO reservations, transfers, returns, replenishment, stocktakes, purchase orders, and goods receipts.
- `apps/sales-service` owns carts, orders, delivery addresses, prescriptions, counter transactions, delivery snapshots, and sales outbox events.
- `apps/payment-service` owns invoices, attempts, transactions, refunds, QR instructions, SePay verification, and reconciliation.
- `apps/operations-query-service` owns event-fed dashboard, finance, reporting, and audit projections.
- Edge ingress and routing are handled by AWS API Gateway (HTTP API), Lambda Authorizer, VPC Link, and an internal ALB (configuration-only in `deploy/aws`, no resources deployed). API Gateway handles CORS and throttling. The authorizer handles session verification, role and site authorization, CSRF validation, and HMAC-signed internal identity context.

Shared packages contain only technical infrastructure and versioned transport contracts. Apps never import another app.

## Consistency model

- Each service commits its own database transaction.
- Domain events use outbox rows and RabbitMQ delivery.
- Consumers use idempotent inbox or projection keys.
- Reservations, payment confirmation, and fulfillment use explicit commands and compensation paths.
- Browser-supplied prices, distances, route geometry, fees, store ranking, and user identity are not authoritative.
- Delivery checkout recalculates the selected store route and snapshots the provider address, note, distance, duration, fee, and GeoJSON.

## Security model

- Identity uses opaque, revocable session cookies.
- Lambda Authorizer validates sessions against `identity-service` to derive actor identity.
- Employee route groups require an employee account.
- Lambda Authorizer forwards a short-lived HMAC-signed internal identity context (`x-internal-identity-context`, `x-actor-id`, `x-actor-type`, `x-request-id`) to backend services via API Gateway integration mapping.
- Mutating browser requests require a CSRF token, except external SePay webhooks.
- SePay webhooks pass through API Gateway preserving raw request bytes and verify HMAC in `payment-service`.
- Production requires API Gateway throttling, configured internal signing secrets, and service-side verification of signed identity context.

## Delivery architecture

Customers select a retail store and a destination marker. `sales-service` resolves the marker through OpenRouteService reverse geocoding, calls the `driving-car` Matrix and Directions APIs, and returns a LineString route. Valkey caches namespaced results. Cache failure does not become the source of truth, and provider timeout or quota failures produce a controlled upstream error. Pickup always has a zero delivery fee. Delivery fees use the configured per-kilometer rate with minimum and maximum bounds and no base fee.

## Deployment

Docker Compose provides the local topology. AWS ECS Fargate deployment configuration with AWS API Gateway, VPC Link, internal ALB, and Lambda Authorizer is defined in `deploy/aws` (configuration-only; no AWS resources were deployed). Images and platform dependencies use pinned digests. GitHub Actions runs Nx affected validation on pull requests. Releases run on demand through a manual workflow that validates the workspace and publishes digest-addressed GHCR application images for the requested version.

See [Baseline.md](Baseline.md) and [Runbooks.md](Runbooks.md) for version constraints, migration, seed, and operational runbook details.
