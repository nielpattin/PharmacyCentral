# Pharmacy Central runbooks

## Local development quickstart

Infra always runs on Docker Compose; the apps run either on the host or in containers (see "Two local modes"). Start here once:

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in secrets
pnpm run infra:up
docker compose ps   # postgres, rabbitmq, valkey, mailpit, otel-collector, seaweedfs, gateway-dev healthy
```

SeaweedFS is local product-image object storage. `seaweedfs-init` creates the `product-media` bucket, and the S3 gateway allows anonymous reads on that bucket only. The S3 API is at `http://localhost:9000`; set the port and credentials (`SEAWEEDFS_*`) in `.env` before starting Compose. Upload caps: the catalog and inventory API groups allow 25 MB per request through the local Nginx proxies, `/api/prescriptions/intake*` allows 10 MB, and the other groups keep Nginx's 1 MB default. `catalog-service` accepts product images up to 5 MB (JPEG, PNG, or WebP); the import endpoints accept up to 25 MB; `sales-service` accepts prescription photos up to 8 MB; other JSON routes keep the 1 MB service default.

Create the databases and seed the local accounts. The seed reads `.env` on its own:

```bash
pnpm run db:migrate
pnpm run seed:accounts
```

`API_BASE_URL=http://localhost:8080` in `.env` points browsers and Vite `dev` at whichever local gateway is running. Never change it per service.

### Two local modes

Infra always runs in Docker. The two modes differ only in where the apps and the gateway run:

| | Dev mode (day-to-day work) | Container mode (check what ships) |
| --- | --- | --- |
| 6 services | Host, `node --watch` | Containers |
| 2 webs | Host, Vite HMR | Containers |
| Gateway on `:8080` | `gateway-dev` container on the host network | `gateway` container |
| Infra | Containers | The same containers |
| Start | `pnpm run infra:up`, then `pnpm dev` | Stop `pnpm dev`, then `pnpm run stack:up` |
| Back to dev mode | | `pnpm run stack:down`, then `pnpm dev` |
| Stop everything | `pnpm run infra:down` | `pnpm run infra:down` |

Use dev mode while coding. Run container mode before opening a pull request, and always after changing a Dockerfile, `docker-compose.yml`, environment variables, dependencies, or migrations; every container in `docker compose ps` must be healthy.

#### Dev mode

```bash
pnpm run infra:up   # infra + gateway-dev
pnpm dev            # nx run-many -t dev --all
```

`pnpm dev` starts every service with `node --watch` and both webs with Vite HMR through Nx, which prints a TUI with one pane per app. Each service's `dev` script runs Node with `--experimental-transform-types`, because Node's strip-only TypeScript mode rejects the parameter properties the services use.

Run a subset by project name (the real names live in `apps/*/package.json`). `gateway-dev` still routes every path to the host, so paths of apps you leave out have no process behind them:

```bash
pnpm nx run-many -t dev -p @pharmacy/sales-service @pharmacy/customer-web
```

Ports come from `<SVC>_PORT` in the root `.env`. Nx loads `apps/<svc>-service/.env.dev` for the `dev` target before the root `.env`, so it wins over the root `.env`'s shared `PORT=3000`; each service binds its own port and gets its own `DATABASE_URL`. Run apps through Nx: `pnpm --dir apps/<app> dev` bypasses Nx and skips `.env.dev`, so every service would collide on `PORT=3000`.

Services reach infra through the published ports (`localhost:5432`, `localhost:5672`, ...), never through a gateway. The gateway only forwards browser `/api/...` calls to the services. `gateway-dev` is the one container that has to call into the host, and host firewalls such as ufw drop container-to-host traffic on the Docker bridge, so it uses host networking and forwards to `127.0.0.1:${<SVC>_PORT}` instead.

#### Container mode

```bash
# Stop `pnpm dev` first: the app containers publish the same host ports.
pnpm run stack:up     # stops gateway-dev, rebuilds the images, starts everything, waits until healthy
docker compose ps     # every container must be healthy
pnpm run stack:down   # back to dev mode: stops gateway and the app containers, starts gateway-dev again
```

`gateway` and `gateway-dev` share `GATEWAY_PORT` (8080), so only one runs at a time; the two scripts swap them. On a small machine, building all eight images at once can exhaust memory; build them one at a time first with `docker compose build <name>`.

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
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8080/api/auth/login   -H 'Content-Type: application/json'   -d '{"email":"admin@pharmacycentral.vn","password":"DemoPassword123!"}'
CTX=$(curl -s -b cookies.txt http://localhost:8080/api/auth/context)
SALES=$(echo "$CTX" | python3 -c "import json,sys; print(json.load(sys.stdin)['contexts']['sales-service'])")
curl -s -b cookies.txt http://localhost:8080/api/orders -H "x-internal-identity-context: $SALES"
```

Mutations also send the CSRF token from the `pharmacy_csrf` cookie as `X-CSRF-TOKEN`.

### Path routing map

Both local gateways forward paths with identical patterns: `gateway` (container mode) sends them to the app containers, and `gateway-dev` (dev mode) forwards the same paths to the host processes. The rules live once in `deploy/local/gateway/routes.conf`, included by both server blocks.

- `/api/auth*`, `/api/admin*` -> `identity-service:3001`
- `/api/sites*`, `/api/storage-locations*`, `/api/products*`, `/api/suppliers*`, `/api/pricing*`, `/api/stores*`, `/api/availability*` -> `catalog-service:3002`
- `/api/procurement*`, `/api/inventory*`, `/api/quality*` -> `inventory-service:3004`
- `/api/carts*`, `/api/orders*`, `/api/delivery*`, `/api/prescriptions*`, `/api/counter-transactions*` -> `sales-service:3005`
- `/api/payments*` -> `payment-service:3006`
- `/api/operations*`, `/api/dashboard*`, `/api/finance*`, `/api/audit*`, `/api/reports*` -> `operations-query-service:3007`

Any other path, `/` included, returns a JSON 404. Either gateway strips `/api` before forwarding.

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

Seed the local demo accounts:

```bash
pnpm run seed:accounts
```

Tear everything down (including `gateway-dev`):

```bash
pnpm run infra:down
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `localhost:8080` refused or 502 from `/api/...` | Start the gateway for your mode: `pnpm run infra:up` for dev mode, or `pnpm run stack:up` for containers. Only one of the two can hold port 8080 |
| Gateway 404 on `/api/...` | Check the path against the routing map above |
| `/api/...` returns 401 `trusted_request_required` | The path needs an identity token. Fetch `/api/auth/context` after login and send the matching service token as `x-internal-identity-context` |

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

### Seed demo accounts

Only `identity-service` seeds data, and it seeds local login accounts only. Business master data is imported through the staff import center or the catalog/inventory import APIs.

```bash
# Seed the three local accounts
pnpm run seed:accounts

# Validate without writing
pnpm --dir apps/identity-service seed -- --dry-run
```

`DEMO_ACCOUNT_PASSWORD` from `.env` becomes the password for the seeded accounts. Site access is not seeded; a Pharmacy Manager must be assigned to an imported site from the Users screen.

### Import staff-managed data

Staff import CSV files from the Data import screen in `staff-web`. The matching API endpoints are:

| Dataset | Endpoint |
| --- | --- |
| Sites, storage locations, suppliers, products, units, prices | `POST /api/products/imports` |
| Opening stock balances | `POST /api/inventory/imports/opening-balances` |

The screen generates one CSV template per dataset in the browser from the same column list the parser uses.
Templates contain headers only: no sample records ship with the web app, and nothing under an app `public/`
directory is a data store. The browser converts the CSV into the JSON payload that the service validates; the
HTTP contract stays JSON.

Import order matters, because rows are resolved by natural key: sites first, then storage locations and
suppliers, then products, then opening balances.

Source files stay outside the application image. The committed fixture set lives in `data/`: the sample CSVs in
`data/import-samples/` and the coursework image set as `data/product-images/images.tar.gz`, so a fresh checkout can
exercise both flows. Any other file comes from the operator machine (`~/Downloads/...`), and the API never reads a
server-side path. Import in dependency order: images (`images:import`, since `products.csv` carries SeaweedFS URLs whose
object keys are content hashes), then sites, storage locations, suppliers, products, and finally opening balances. After
an import the truth lives in the owning service database: catalog data in `catalog-service`, stock in
`inventory-service`, images in SeaweedFS. Extracted images, original downloads, source-verification records
(`provenance/`), and research dumps (`research/`) stay local.

Imports are idempotent on natural keys (`code`, `sku`, `batchNumber`). An opening balance row is accepted only while the batch and storage location have no stock balance or ledger history. Reimporting the same quantity is a no-op; changing an existing balance requires a stock adjustment so the ledger keeps an audit trail.

```bash
pnpm run infra:up
```

Then open `http://127.0.0.1:5174/imports` from the staff web app.

### Import local product images

The image command uploads the committed image archive to the local SeaweedFS bucket and prints the public URL
of each image. It does not touch the database.

```bash
pnpm run infra:up
pnpm run images:import        # data/product-images/images.tar.gz -> SeaweedFS, prints sku,imageUrl
```

The committed image set is one gzip archive (`data/product-images/images.tar.gz`) and every member is named
`<SKU>.<ext>`, so the command takes the SKU from the file name: no manifest, no extraction, no flags. It
validates every file before uploading anything, then prints `sku,imageUrl` per image. The URLs are exactly
the ones `data/import-samples/products.csv` already carries, because the object key is the content hash
(`product-images/<SKU>/<sha256>.<ext>`), so they are reproducible for everyone who runs the command.

The files keep their source formats and pixel dimensions (30 JPEG + 20 PNG, 44.2 MB → 16.8 MB) and are sized
down by re-encoding only: indexed-colour PNG (≤256 colours) and JPEG quality 92 at 4:4:4. The originals stay
local in the ignored `data/product-images/originals/`. `images:pack` regenerates the archive after the set
changes; `images:unpack` extracts it with `tar` for inspection (the import does not need it).

`data/` is excluded from container builds via `.dockerignore`, so the images only reach SeaweedFS through that
command. Source-verification records (source URLs, byte counts, SHA-256, download summary, review sheet) stay
local in `data/product-images/provenance/`.

### Try prescription intake

Prescription intake needs the catalog migrations `0005_text_search_extensions` (`pg_trgm` and `unaccent`) and `0006_folded_trigram_indexes` (the `catalog_fold` function and its trigram indexes), so run `pnpm run db:migrate` after pulling. Import `products.csv` first, because suggestions come from the catalog.

1. Set `GEMINI_API_KEY`, `GEMINI_BASE_URL`, and `GEMINI_MODEL` in `.env` (see `.env.example`) to read photos. With an empty `GEMINI_API_KEY` the photo path answers `503` and only QR intake works.
2. Sign in as the customer account and open `http://localhost:5173/gui-don-thuoc`.
3. Upload a page from `data/prescription-samples/`. `<slug>.png` carries a QR (read in the browser, no provider call); `<slug>-no-qr.png` is the same page without it and exercises Gemini. `<slug>.json` is the ground truth to compare against.

`pnpm run prescriptions:samples` generates those pages. They are fictional prescriptions whose medicines mostly come from `products.csv`, and like other generated output they stay local and are not committed.

### Demo credentials

Demo credentials for local development. The password is the `DEMO_ACCOUNT_PASSWORD` value from `.env`.

| Role | Email | Site access |
| --- | --- | --- |
| Platform Admin | `admin@pharmacycentral.vn` | All sites |
| Pharmacy Manager, Pharmacist | `manager@pharmacycentral.vn` | Assign after importing sites from the Users screen |
| Customer | `khachhang@pharmacycentral.vn` | Customer portal |

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

SePay signs `${timestamp}.${rawBody}` with the webhook Secret Key over the raw request bytes and sends
`X-SePay-Signature: sha256=<hex>` plus `X-SePay-Timestamp` (Unix seconds, replay window 5 minutes). Configure the webhook on
my.sepay.vn with payload format **JSON**, event **Tiền vào** (in), auth **HMAC-SHA256**, and payment code prefix `PC` so SePay
reports `code` for our `PC-…` transfer content. Create an invoice, then replay a signed payload:

```bash
body='{"gateway":"MBBank","transactionDate":"2026-08-28 10:00:00","accountNumber":"0000000001","code":"PC-5B3F7A1C9E24D608","content":"PC-5B3F7A1C9E24D608 thanh toan","transferType":"in","transferAmount":12500,"referenceCode":"SB123"}'
timestamp=$(date +%s)
signature=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$SEPAY_WEBHOOK_SECRET" -r | cut -d' ' -f1)
curl -sS -X POST http://localhost:3006/payments/sepay/webhook \
  -H "Content-Type: application/json" \
  -H "x-sepay-timestamp: $timestamp" \
  -H "x-sepay-signature: sha256=$signature" \
  -d "$body"
```

`payment-service` verifies the signature and timestamp, requires an inbound transfer, matches payment code and invoice amount, and
updates the payment status. Verified deliveries always answer `200 {"success": true}` — SePay treats any other status or body as a
failed delivery and retries; an unverifiable signature answers `401` and is never processed.

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
- Delivery cache misses call Vietmap for the address label and OpenRouteService for the route. Cache keys carry a version, so a change in what a cached calculation contains bumps it.
- Cache outages never alter order fees or transition business states.

## Rollback and deployment

- Application container images use immutable content digests (`image@sha256:...`).
- Container startup executes `node dist/migrate.js` before `node dist/main.js`.
- Roll back releases by deploying the previous immutable image digest when migrations are backward-compatible.
