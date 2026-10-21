# Pharmacy Central runbooks

## Local development quickstart

Infra always runs on Docker Compose; the apps run either on the host or in containers (see "Two local modes"). Start here once:

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in secrets
pnpm run infra:up
docker compose ps   # postgres, rabbitmq, redis, mailpit, otel-collector, seaweedfs, gateway-dev healthy
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

Services also call each other directly, with the `*_SERVICE_URL` values in `.env` (`CATALOG_SERVICE_URL`, `IDENTITY_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL`), never through a gateway. `sales-service` requires `IDENTITY_SERVICE_URL`: it looks the account up there before filing a prescription with a customer, so a missing or wrong value fails the create with `503 identity_unavailable` instead of writing the record against nobody. `payment-service` and `operations-query-service` require `SALES_SERVICE_URL` for the order behind an invoice and for the dashboard's prescription figures.

On Docker Desktop (Windows and macOS), host networking runs inside the Docker VM, so `gateway-dev` needs it turned on. Open Settings, then Resources, then Network, and turn on **Enable host networking** (Docker Desktop 4.34 or later). Choose Apply & restart, then run `pnpm run infra:up` again. Without it, the container reports healthy but nothing listens on `localhost:8080`, and the Vite proxy logs `http proxy error: /api/... AggregateError [ECONNREFUSED]` for every call. Check with `curl http://localhost:8080/api/products?limit=1`. Linux hosts need no setting.

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

- `/api/auth*`, `/api/admin*`, `/api/customers*` -> `identity-service:3001`
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
| Vite logs `http proxy error: /api/... ECONNREFUSED` while `gateway-dev` is healthy (Docker Desktop) | Host networking is off, so port 8080 never reaches the host. Enable it as described under Dev mode, then rerun `pnpm run infra:up` |
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
# Seed one local account per role
pnpm run seed:accounts

# Validate without writing
pnpm --dir apps/identity-service seed -- --dry-run
```

`DEMO_ACCOUNT_PASSWORD` from `.env` becomes the password for the seeded accounts. The seed creates one account per role (Platform Admin, Pharmacy Manager, Pharmacist, Warehouse Staff, Customer), each holding only that role, and resets their roles and site access on every run. Site access is looked up by code from the imported sites (`SITE-RTL` for the manager and pharmacist, `SITE-WH` for warehouse staff); before the sites import the seed warns which are missing, so run it again after importing `data/import-samples/sites.csv`. The account list is in `docs/UserGuide.md`.

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
`data/import-samples/` and the coursework images as the folder `data/product-images/images/`, so a fresh checkout can
exercise both flows. Any other file comes from the operator machine (`~/Downloads/...`), and the API never reads a
server-side path. Dependency order matters. Images come first (uploaded by `dev:data`, since `products.csv` carries SeaweedFS URLs whose
object keys are content hashes), then sites, storage locations, suppliers, products, and finally opening balances. After
an import the truth lives in the owning service database: catalog data in `catalog-service`, stock in
`inventory-service`, images in SeaweedFS. Original downloads, source-verification records
(`provenance/`), and research dumps (`research/`) stay local.

Imports are idempotent on natural keys (`code`, `sku`, `batchNumber`). An opening balance row is accepted only while the batch and storage location have no stock balance or ledger history. Reimporting the same quantity is a no-op; changing an existing balance requires a stock adjustment so the ledger keeps an audit trail.

```bash
pnpm run infra:up
```

Then open `http://127.0.0.1:5174/imports` from the staff web app.

#### Local sample data (development only)

A fresh local database has no accounts and no master data. Migrations create empty tables, and sites, storage locations, suppliers, products, prices, and opening stock exist only after an import. The steps below fill all of it:

```bash
pnpm run infra:up   # infra + gateway-dev (host networking on Docker Desktop)
pnpm run db:migrate
pnpm dev            # the services must be running: the import goes through the API
pnpm run dev:data   # in another terminal
```

`dev:data` runs `tools/dev-import-samples.mjs` and performs the steps in order. It seeds the demo accounts, uploads the product images to SeaweedFS, and signs in as the demo admin (`admin@pharmacycentral.vn`, password `DEMO_ACCOUNT_PASSWORD`). It posts the sample CSVs from `data/import-samples/` to the same endpoints as the Data import screen. Then it seeds the accounts again, so the manager, pharmacist, and warehouse accounts get their `SITE-RTL` / `SITE-WH` access. It reuses the screen's CSV mapping from `apps/staff-web/src/import-datasets.ts`, so the two cannot drift. Every step is idempotent, so running the script again is safe. Stock rows wait for the product search index to catch up, which takes a few seconds after a product import.

Last, it creates and approves the six local search synonym groups, such as `tiêu chảy, đi ngoài, đi lỏng`. The demo admin creates them, and the demo pharmacist approves them, so live search uses them from the start. Production starts with no synonym groups. Staff add them in staff-web under Search synonyms.

This is a development tool, kept apart from production on purpose.

- It only runs from the `dev:data` script, is not part of any image or deployment, and uses the demo admin that only the local seed creates.
- It refuses to run with `NODE_ENV=production` and refuses any `API_BASE_URL` that is not `localhost`, `127.0.0.1`, or `[::1]`.
- The sample files are fabricated coursework data. Production data is imported by an operator on the staff-web Data import screen with a real account, from the operator's own files.

Without the script, run `pnpm run seed:accounts`, then upload the same files by hand at `http://127.0.0.1:5174/imports`, in this order: `sites.csv`, `storage-locations.csv`, `suppliers.csv`, `products.csv`, and `opening-balances.csv`. Finally, run `pnpm run seed:accounts` again.

### Product images

The committed images are one file per product in `data/product-images/images/`, named `<SKU>.<ext>` (PNG, JPEG, or WebP). `pnpm run dev:data` uploads them to the local SeaweedFS bucket under the content-hash key `product-images/<SKU>/<sha256>.<ext>`, so the URL is the same for everyone and matches the `imageUrl` column of `data/import-samples/products.csv`. The upload validates every file before sending any, and the script warns about a product whose `imageUrl` was not uploaded. To add or replace an image, drop `<SKU>.<ext>` into the folder, rerun the command, and copy the new URL into `products.csv`. Original downloads and source-verification records stay local in `data/product-images/originals/` and `provenance/`. `data/` is excluded from container builds via `.dockerignore`.

### Try prescription intake

Prescription intake needs the catalog migrations `0005_text_search_extensions` (`pg_trgm` and `unaccent`) and `0006_folded_trigram_indexes` (the `catalog_fold` function and its trigram indexes), so run `pnpm run db:migrate` after pulling. Consultation requests also need the `sales-service` migration `0005_salty_trish_tilby` (the `prescription_consultations` table), which the same command applies. Import `products.csv` first, because suggestions come from the catalog.

1. Sign in to staff-web as `admin@pharmacycentral.vn`, open **AI integrations**, and save the provider, model, base URL and API key under **Prescription photo reading**. Or set all four `AI_PRESCRIPTION_READER_*` variables in `.env` (see `.env.example`), which are all or none. Until settings are saved, or the four variables are set, the photo path answers `503` and only QR intake works.
2. Sign in as the customer account and open `http://localhost:5173/gui-don-thuoc`.
3. Upload a page from `data/prescription-samples/`. `<slug>.png` carries a QR (read in the browser, no provider call); `<slug>-no-qr.png` is the same page without it and exercises Gemini. `<slug>.json` is the ground truth to compare against.
4. The sample has one prescription, `tang-huyet-ap-dai-thao-duong`, with six lines. Five match catalog products: Amlodipin 5mg, Savi Losartan 50mg, Diamicron MR 30mg, Atorvastatin 20mg and Plavix 75mg. These are prescription-only with no price, so the page shows "Liên hệ báo giá" and they cannot be added to the cart.
5. Aspirin 81mg has no catalog match, so the page offers "Nhờ dược sĩ tìm giúp" for the whole prescription; the request is filed through `POST /prescriptions/consultations` with that line flagged.

`pnpm run prescriptions:samples` generates that page. Its medicines all come from `products.csv`, and like other generated output it stays local and is not committed.

### Chatbot token usage

The chatbot service logs one line for each question the model answers. The message is `chat turn usage`. The line has five counts: input tokens, cached input tokens, output tokens, thought tokens, and `modelCalls`. `modelCalls` is the number of model calls made for that question, at most three. A question that needs no product lookup has one model call. A high thought count means the model spent many tokens reasoning at its thinking level. A cached count above zero means implicit caching hit. Caching cannot start until the stable prompt prefix reaches the model's minimum size, so a cached count of zero is expected while the prompt stays below that minimum. The line holds counts only, never the question, the reply, or any customer or product data.

### Intent gate

The intent gate runs one TypeSafe Jev request before each question reaches the chat model. Its settings use the purpose `INTENT_GATE`, the environment group `AI_INTENT_GATE_*`, and the staff-web card **Question screening**. With no settings the gate is off.

- Each decision logs `intent gate decision` with the fields `decision`, `reason`, `intent`, `intentConfidence`, `emergency`, and `injection`.
- A Jev failure after the retries answers `503 assistant_unavailable`. The service logs `chat dependency failed` with the error `IntentGateError`.
- The timeout and retry constants are `ATTEMPT_TIMEOUT_MS = 4000`, `MAX_ATTEMPTS = 3`, `BACKOFF_BASE_MS = 200` and `BACKOFF_CAP_MS = 2000` in `apps/chatbot-service/src/infrastructure/jev-intent-classifier.ts`.
- The thresholds are `EMERGENCY_THRESHOLD = 0.6`, `INJECTION_THRESHOLD = 0.7` and `INTENT_CONFIDENCE_THRESHOLD = 0.6` in `apps/chatbot-service/src/modules/chat/intent-policy.ts`. They are untuned starting values.

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

`pnpm test` runs one project's tests at a time (`"parallelism": false` on the `test` target in `nx.json`). The database tests start an in-process PGlite and apply every migration in `beforeAll`. With several projects testing at once, that hook ran past Vitest's 10-second limit. The whole run takes about 45 seconds. The Nx terminal UI closes by itself when the run ends (`"tui": { "autoExit": true }`).

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
  The outbox publisher of `inventory`, `sales` and `payment` marks a row published only after the broker confirmed it,
  so a row stays unpublished while the broker is down and goes out when it is back. An advisory lock lets one
  publisher per database send at a time. Delivery is at least once.
- Consumers process messages idempotently using inbox deduplication keys.
- Consumers read durable quorum queues named `<owner>.<topic>.v2` (`sales.payment-events.v2`,
  `catalog.availability.v2`, `operations-query.events.v2`), one message at a time. All of them reconnect on their own
  when the broker drops them.
- A message that keeps failing is retried five times with a growing delay, then rejected. The broker moves it through
  the exchange `pharmacy.events.dead` to the parking queue `<queue>.dead`. A payload that is not JSON, or that is not a
  well-formed event, is parked at once. A non-empty `.dead` queue always means an event nobody applied: find the cause
  in the service log (`failed for good, dead-lettering it`), fix it, then publish the message again to
  `pharmacy.events` with its original routing key.
- Queue arguments cannot be changed on an existing queue, so a change of arguments ships as a new queue name. After
  such a release delete the abandoned queue (for the move to `.v2`:
  `rabbitmqctl delete_queue sales.payment-events.v1`, `catalog.availability.v1`, `operations-query.events.v1`),
  otherwise it keeps collecting copies of every event that nobody reads.
- Inspect the `pharmacy.events` exchange and consumer queues via RabbitMQ Management UI (`http://localhost:15672`, guest/guest).

## Online order stock

An online order holds stock in inventory-service from the moment it is placed.

- `POST /api/orders` asks inventory to hold the lines against every storage location of the store's site, earliest
  expiry first, all or nothing. The order id is the reservation id. A store that cannot cover the order answers `409
  insufficient_stock`; inventory being down answers `503 stock_unavailable`. In both cases the order is cancelled
  and nothing stays held.
- `orders.stock_hold` says what inventory may still hold: `held`, then `released` (given back) or `consumed` (handed
  over). `none` marks an order from before holds existed, and those are never swept or consumed.
- The goods leave the shelf only when staff move the order to `Delivering` or `Completed`: sales asks inventory to
  consume the reservation first, and the status does not change when inventory cannot be reached (`502`). Only staff
  can run those moves. A shopper can only withdraw their own order while nothing was paid.
- A sweep in sales-service runs every minute. It cancels an order that is still unpaid after 30 minutes (QR, or no
  method named) or 24 hours (cash on delivery), then gives back the hold of every cancelled order that still says
  `held`. A refund (`payment.invoice.refunded.v1`) cancels an order that was not handed over and frees its hold.
- A payment that arrives for an order that was already cancelled cannot be reversed by the system: sales logs
  `a cancelled order was paid and needs a refund`. Search the sales log for it and refund the invoice by hand.
- Payment-service prices a shopper invoice from the order in sales-service. The request's unit prices are ignored.

## Cache policy

Redis stores rate-limit counters and delivery route calculations.

- PostgreSQL remains the authoritative source of truth.
- Delivery cache misses call Vietmap for the address label and OpenRouteService for the route. Cache keys carry a version, so a change in what a cached calculation contains bumps it.
- Cache outages never alter order fees or transition business states.

## Rollback and deployment

- Application container images use immutable content digests (`image@sha256:...`).
- Container startup executes `node dist/migrate.js` before `node dist/main.js`.
- Roll back releases by deploying the previous immutable image digest when migrations are backward-compatible.
