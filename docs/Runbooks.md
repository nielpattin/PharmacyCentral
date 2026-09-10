# Pharmacy Central runbooks

## Local development quickstart

All local work runs on Docker Compose. Start here once:

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in secrets
pnpm run infra:up
docker compose ps   # postgres, rabbitmq, valkey, mailpit, otel-collector healthy
```

Create the databases and load demo data. Seeds read `.env` on their own:

```bash
pnpm run db:migrate
pnpm run seed:demo
```

`API_BASE_URL=http://localhost:8080` in `.env` points browsers and Vite `dev` at the local `gateway`. Never change it per service.

### Mode A: work on one service

Run the service you own from source with hot reload. Start its dependencies as images by name:

```bash
docker compose up -d gateway catalog-service sales-service
pnpm --dir apps/sales-service dev
```

Edit, save, and the process restarts. Dependencies you do not own stay as stable images.

### Mode B: work on a web app

Run the web app from source. It hot-reloads against the gateway and the full backend:

```bash
docker compose up -d gateway identity-service catalog-service inventory-service sales-service payment-service operations-query-service
pnpm --dir apps/customer-web dev
```

The Vite config reads `API_BASE_URL` from the repository-root `.env` on its own and proxies `/api/...` to the gateway. A bare `pnpm dev` with no exported variables works. If the app shows `API request failed with status 404` on load, the proxy missed: check that `API_BASE_URL=http://localhost:8080` is set in `.env` and the gateway container is up.

Swap the 1 or 2 services you own to source (`pnpm --dir apps/<service> dev`) and leave the rest as images.

### Mode C: full system

For occasional end-to-end checks and CI:

```bash
docker compose up -d --build
docker compose ps
```

Do not build many services at once on a small machine. Eight parallel image builds exhaust memory and stall. Build one service at a time instead:

```bash
docker compose up -d --build <name>
```

### Open the app

```bash
curl http://localhost:8080/healthz
curl -s http://localhost:8080/api/sites | head -c 200
```

The second command returns the site list with status 200. Catalog reads are public. A 401 with `trusted_request_required` means the path needs a signed identity context (see the hand-call recipe below). A 401 with `unauthenticated` means the session cookie is missing or expired.

### Call the API by hand

Browsers authenticate with the `pharmacy_session` cookie. Authenticated service calls also need the per-service token from `/api/auth/context`:

```bash
curl -s -c cookies.txt http://localhost:8080/api/auth/csrf
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8080/api/auth/login   -H 'Content-Type: application/json'   -d '{"email":"admin@pharmacy.local","password":"DemoPassword123!"}'
CTX=$(curl -s -b cookies.txt http://localhost:8080/api/auth/context)
SALES=$(echo "$CTX" | python3 -c "import json,sys; print(json.load(sys.stdin)['contexts']['sales-service'])")
curl -s -b cookies.txt http://localhost:8080/api/orders -H "x-internal-identity-context: $SALES"
```

Mutations also send the CSRF token from the `pharmacy_csrf` cookie as `X-CSRF-TOKEN`.

### Path routing map

The ingress forwards paths with identical patterns:

- `/api/auth*`, `/api/admin*` -> `identity-service:3001`
- `/api/sites*`, `/api/storage-locations*`, `/api/products*`, `/api/suppliers*`, `/api/pricing*`, `/api/stores*`, `/api/availability*` -> `catalog-service:3002`
- `/api/procurement*`, `/api/inventory*`, `/api/quality*` -> `inventory-service:3004`
- `/api/carts*`, `/api/orders*`, `/api/delivery*`, `/api/prescriptions*`, `/api/counter-transactions*` -> `sales-service:3005`
- `/api/payments*` -> `payment-service:3006`
- `/api/operations*`, `/api/dashboard*`, `/api/finance*`, `/api/audit*`, `/api/reports*` -> `operations-query-service:3007`
- `/` -> `customer-web`

`/` serves `customer-web`. The rewrite strips `/api` before forwarding.

## Daily commands

Check status and logs:

```bash
docker compose ps
docker compose logs <name>
docker compose logs -f <name>
```

Restart one service:

```bash
docker compose restart <name>
```

Rebuild one service image after a change you want to validate as shipped:

```bash
docker compose up -d --build <name>
```

Open backing tools on your laptop (ports come from `.env`):

```bash
# RabbitMQ management UI at http://localhost:15672, Mailpit UI at http://localhost:8025
```

Seed one service database:

```bash
pnpm --dir apps/<service> seed
```

Tear everything down:

```bash
docker compose down
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `localhost:8080` refused or 502 from `/api/...` | Start the gateway: `docker compose up -d gateway` |
| Gateway 404 on `/api/...` | Check the path against the routing map below |
| `/api/...` returns 401 `trusted_request_required` | The path needs an identity token. Fetch `/api/auth/context` after login and send the matching service token as `x-internal-identity-context` |

## Choosing which services run

Name services explicitly. Compose starts dependencies automatically through `depends_on`:

```bash
docker compose up -d gateway sales-service   # gateway plus one backend and healthy infra
docker compose up -d customer-web            # web plus gateway is pulled in the same way
```

Web apps run from source with `pnpm --dir apps/<web> dev`. Backend services run from source with `pnpm --dir apps/<service> dev`. Images are only for dependencies you are not editing.

## Runtime contract

Use Node.js 24.19.x and pnpm 12.3.4+. Node 25 or later is rejected by the workspace engine policy.

```bash
pnpm install --frozen-lockfile
```

## Database migrations and seeds

Each microservice owns its Drizzle migrations and database schema under `apps/<service>/drizzle/migrations`.

### Run migrations

Migrate all services with one command (runs each service from its own directory so every database is targeted correctly):

```bash
pnpm run db:migrate
```

In containers, each service executes its compiled `node dist/migrate.js` on startup.

### Run seeds

The seed is deterministic and idempotent. It creates demo users, catalog sites, locations, products, pricing, suppliers, inventory batches, purchase orders, carts, orders, invoices, and audit projections.

```bash
# Seed all services in dependency order
pnpm run seed:demo

# Dry-run validation
pnpm run seed:demo --dry-run

# Or seed an individual service directly
pnpm --dir apps/catalog-service seed
```

### Demo credentials

Demo credentials for local development:

| Role | Email | Password | Site Access |
| --- | --- | --- | --- |
| Platform Admin | `admin@pharmacy.local` | `DemoPassword123!` | All sites |
| Pharmacy Manager | `manager@pharmacy.local` | `DemoPassword123!` | Retail store (`SITE-RTL`) |
| Customer | `customer@pharmacy.local` | `DemoPassword123!` | Customer portal |

## Workspace verification

Run all verification gates from repository root:

```bash
pnpm run fmt:check
pnpm run sync:check
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm test
git diff --check
```

Each service also supports running its local checks independently:

```bash
cd apps/catalog-service
pnpm run fmt:check
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
```

## Edge routing and security

- AWS API Gateway HTTP API exposes `/api` routes with a Lambda authorizer.
- Sessions use the opaque `pharmacy_session` HttpOnly cookie.
- The authorizer validates sessions against `identity-service` and injects HMAC-signed identity context (`x-internal-identity-context`, `x-actor-id`, `x-actor-type`, `x-request-id`), discarding any client-supplied identity headers.
- Mutating browser requests require CSRF tokens. The external SePay webhook route is the explicit exception and uses HMAC payload verification.

## Payment webhook test

Set a local `SEPAY_WEBHOOK_SECRET`, create an invoice, and sign the raw JSON bytes with HMAC-SHA256:

```bash
curl -X POST http://localhost:3006/payments/sepay/webhook \
  -H "Content-Type: application/json" \
  -H "x-sepay-signature: <computed-hmac-sha256>" \
  -d '{"gateway":"VietQR","transactionDate":"2026-08-28 10:00:00","accountNumber":"0123456789","code":"PC-DEMO0001","content":"PC-DEMO0001","transferType":"in","transferAmount":12500,"referenceCode":"REF123"}'
```

`payment-service` verifies the signature, requires an inbound transfer, matches payment code and invoice amount, and updates the payment status.

## Migration recovery

Drizzle migration history is service-local. If a migration fails:

1. Stop the affected service container.
2. Inspect the migration tracking table: `drizzle.__drizzle_migrations`.
3. Fix the migration script or repair the database state.
4. Rerun `pnpm --dir "apps/<service>" db:migrate`.
5. Restart the service container.

Never use `drizzle-kit push` in shared, staging, or production environments.

## Messaging operations

Local development uses a single RabbitMQ node.

- Producers publish events using confirmation channels and the transactional outbox pattern.
- Consumers process messages idempotently using inbox deduplication keys.
- Inspect the `pharmacy.events` exchange and consumer queues via RabbitMQ Management UI (`http://localhost:15672`, guest/guest).

## Cache policy

Valkey stores rate-limit counters and delivery route calculations.

- PostgreSQL remains the authoritative source of truth.
- Delivery cache misses call OpenRouteService directly.
- Cache outages never alter order fees or transition business states.

## Rollback and deployment

- Application container images use immutable content digests (`image@sha256:...`).
- Container startup executes `node dist/migrate.js` before `node dist/main.js`.
- Roll back releases by deploying the previous immutable image digest when migrations are backward-compatible.
