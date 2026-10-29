# Pharmacy Central runbooks

## Local development quickstart

Infra always runs on Docker Compose; the apps run either on the host or in containers (see "Two local modes"). Start here once:

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in secrets
pnpm run infra:up
docker compose ps   # postgres, rabbitmq, redis, mailpit, otel-collector, floci, gateway-dev healthy (floci-init exits 0)
```

Floci is the local AWS emulator (image `floci/floci:latest`, port 4566). It serves S3 for product images and ECR for image push tests. `floci-init` creates the `product-media` bucket and a policy that allows anonymous `GetObject` on it. The S3 API is at `http://localhost:4566` with path-style addressing; set `FLOCI_PORT`, the standard `AWS_*` variables (dummy keys, `us-east-1`), `MEDIA_BUCKET`, and `PUBLIC_MEDIA_URL` in `.env` before starting Compose. Floci mounts the Docker socket so it can start the `registry:2` container behind ECR, and its state lives in the `pharmacy-central-floci-data` volume. ECR URIs use the path style (`localhost:4566/<account>/<region>/<repo>`) because Docker 29's containerd image store reaches only `localhost` over plain HTTP. `.env` holds the emulator's dummy `AWS_*` values, so never load it into a process that talks to real AWS (`tools/aws-upload-media.mjs` refuses to run with `AWS_ENDPOINT_URL_S3` set). Upload caps: the catalog and inventory API groups allow 25 MB per request through the local Nginx proxies, `/api/prescriptions/intake*` allows 10 MB, and the other groups keep Nginx's 1 MB default. `catalog-service` accepts product images up to 5 MB (JPEG, PNG, or WebP); the import endpoints accept up to 25 MB; `sales-service` accepts prescription photos up to 8 MB; other JSON routes keep the 1 MB service default.

To try the local ECR, use the host AWS CLI with the dummy keys and the explicit `--endpoint-url`, so nothing reaches a real account:

```bash
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
aws ecr create-repository --repository-name pharmacy-central/smoke --endpoint-url http://localhost:4566
aws ecr get-login-password --endpoint-url http://localhost:4566 | docker login --username AWS --password-stdin localhost:4566
docker tag hello-world:latest localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1
docker push localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1
docker pull localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1   # after docker rmi of the tag
```

Floci starts a `floci-ecr-registry` container on first use. It lives outside Compose and keeps running after `docker compose down`; remove it with `docker rm -f floci-ecr-registry`.

Create the databases. The default admin comes with `pnpm run seed:default` and the demo dataset with `pnpm run seed:demo` (see Seeds):

```bash
pnpm run db:migrate
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

Use dev mode for fast iteration and container mode to check what ships. An agent session asks which mode to use before it starts ([AGENTS.md](../AGENTS.md#change-workflow)). Run container mode before opening a pull request, and always after changing a Dockerfile, `docker-compose.yml`, environment variables, dependencies, or migrations; every container in `docker compose ps` must be healthy.

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

### Named local URLs

`pnpm run urls:up` starts a [portless](https://github.com/vercel-labs/portless) proxy on `127.0.0.1:80` and registers three names that point at the fixed ports, for `pnpm dev` and for the container stack alike:

| URL | Target |
| --- | --- |
| `http://customer.pharmacy.localhost` | customer-web (`CUSTOMER_WEB_PORT`) |
| `http://staff.pharmacy.localhost` | staff-web (`STAFF_WEB_PORT`) |
| `http://api.pharmacy.localhost` | gateway (`GATEWAY_PORT`) |

Each name is a separate browser origin. On `localhost` the customer and staff apps share one cookie jar (cookies ignore the port), so signing in to one signs the other out; on the named URLs both stay signed in side by side. `*.localhost` is a secure context in browsers, so `crypto` APIs that need HTTPS work without a certificate. The proxy is plain HTTP; run `pnpm exec portless proxy stop`, then `pnpm exec portless proxy start` for HTTPS (it asks to trust a local CA).

Chrome, Edge and Firefox resolve `*.localhost` themselves. `curl` does too; Node scripts and Safari may not, so `API_BASE_URL` stays `http://localhost:8080` and `pnpm run seed:demo` is unchanged. `pnpm run urls:down` removes the routes and stops the proxy; `pnpm exec portless doctor` checks it. Port 80 must be free; if another program holds it, `urls:up` fails with the portless error.

The web ports are `CUSTOMER_WEB_PORT` (5301) and `STAFF_WEB_PORT` (5302) in the root `.env`. Vite sets `strictPort`, so a busy port makes the app fail instead of moving to another port.

Ports come from `<SVC>_PORT` in the root `.env`. Nx loads `apps/<svc>-service/.env.dev` for the `dev` target before the root `.env`, so it wins over the root `.env`'s shared `PORT=3000`; each service binds its own port and gets its own `DATABASE_URL`. Run apps through Nx: `pnpm --dir apps/<app> dev` bypasses Nx and skips `.env.dev`, so every service would collide on `PORT=3000`.

Services reach infra through the published ports (`localhost:5432`, `localhost:5672`, ...), never through a gateway. The gateway only forwards browser `/api/...` calls to the services. `gateway-dev` is the one container that has to call into the host, and host firewalls such as ufw drop container-to-host traffic on the Docker bridge, so it uses host networking and forwards to `127.0.0.1:${<SVC>_PORT}` instead.

Services also call each other directly, with the `*_SERVICE_URL` values in `.env` (`CATALOG_SERVICE_URL`, `IDENTITY_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL`), never through a gateway. `sales-service` requires `IDENTITY_SERVICE_URL`: it looks the account up there before filing a prescription with a customer, so a missing or wrong value fails the create with `503 identity_unavailable` instead of writing the record against nobody. `payment-service` and `operations-query-service` require `SALES_SERVICE_URL` for the order behind an invoice and for the dashboard's prescription figures. `operations-query-service` also requires `PAYMENT_SERVICE_URL`: the period analytics read the paid invoices from `GET /internal/analytics/paid-invoices`, and it reads sales documents and stock health from `/internal/analytics/*` of `sales-service` and `inventory-service`. Those `/internal` routes accept only the service secret and are not routed by the gateway or the ALB. `inventory-service` requires `IDENTITY_SERVICE_URL` to check the owner of an action plan against `GET /internal/employees/{id}`. Run `pnpm run db:migrate` after pulling: migration `0013_action_plans` adds the plan table and `0014_receipt_line_unit_cost` adds the nullable purchase cost to goods receipt lines. Gross profit on the Analytics page stays "—" for sales whose goods have no recorded unit cost: opening balances carry none, so `seed:demo` receives the shop's stock again through goods receipts with a cost (the demo history step), and your own receipts need a **Giá nhập**; `GET /internal/analytics/dispense-costs` of `inventory-service` is the read behind it.

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
- `GET /api/products` exactly (the product list) -> `search-service:3009`
- `/api/sites*`, `/api/storage-locations*`, `/api/products*` (every other method and path under it), `/api/suppliers*`, `/api/pricing*`, `/api/stores*`, `/api/availability*` -> `catalog-service:3002`
- `/api/procurement*`, `/api/inventory*` -> `inventory-service:3004`
- `/api/carts*`, `/api/orders*`, `/api/delivery*`, `/api/prescriptions*`, `/api/counter-transactions*` -> `sales-service:3005`
- `/api/payments*` -> `payment-service:3006`
- `/api/operations*`, `/api/dashboard*`, `/api/finance*`, `/api/audit*`, `/api/reports*` -> `operations-query-service:3007`
- `/api/system*` -> `ops-console-service:3010`

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
| `typesense` exits with code 139 and no log line (Docker Desktop with WSL2) | Typesense 30.2 bundles brpc, which reads `/proc/self/io` before `main()`. The WSL2 kernel of Docker Desktop has no task I/O accounting, so the file is missing and the 30.2 server segfaults (upstream [typesense/typesense#2998](https://github.com/typesense/typesense/issues/2998)). Compose pins `typesense/typesense:31.0.rc23` by digest, which starts on that kernel (it only logs `Fail to open /proc/self/io`, harmless). Pull it with `docker compose up -d --no-deps --wait typesense`, then check `docker compose ps typesense` and `curl http://localhost:8108/health` (`{"ok":true}`). The AWS task definition (`deploy/aws/data.tf`) pins the same digest, so local and AWS run one version. |

## Runtime contract

Use Node.js 24.19.x and pnpm 12.3.4+. Node 25 or later is rejected by the workspace engine policy.

```bash
pnpm install --frozen-lockfile
```

## Identity rate limits and client address

identity-service requires `REDIS_URL`, `AUTH_RATE_LIMIT_MAX_ATTEMPTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, and `TRUST_PROXY_HOPS`, with no defaults. Startup fails when one is missing or is not a whole number of at least 1.

identity-service also requires `COOKIE_SECURE`, which must be exactly `true` or `false`, with no default. It adds `Secure` to the session, CSRF and OAuth state cookies. Use `false` on the plain-HTTP local URLs and `true` on AWS (`deploy/pharmacycentral.env.example`). The trusted layer of every service drops `x-actor-id` and `x-actor-type` from a request that carries no verified identity context or service secret, and logs a `warn` with the request id when it does; both local gateways also strip those headers from clients. `node --env-file=.env tools/edge-identity-smoke.mjs` checks this against `API_BASE_URL`.

- `TRUST_PROXY_HOPS` is the number of proxies in front of identity-service that append to `X-Forwarded-For`. Locally it is `1`: the nginx gateway overwrites the header with its own `$remote_addr`, so a client cannot supply its own address. Behind AWS the value is unverified. The path is API Gateway HTTP API, then the VPC link, then the internal ALB. Two is the expected value if API Gateway appends the client address and the ALB appends the VPC link address. Confirm that from the `X-Forwarded-For` header of a real request before setting it in `deploy/aws`. A value that is too low keys every client to a proxy address, and a value that is too high lets a client choose its own.
- The Compose stack reaches identity-service through the nginx gateway. Docker usually presents host clients to nginx as the bridge gateway address, which is not verified here, so locally the limit may be one bucket per account rather than per client.
- When Redis is unreachable, `POST /api/auth/login`, `register`, `request-password-reset`, and `reset-password`, and `GET /api/auth/verify-email` answer `503 rate_limit_unavailable`. Sessions are stored in Postgres, so `GET /api/auth/me` keeps working.
- To clear a lockout for a support request, find the account's keys with `redis-cli --scan --pattern 'identity:auth-limit:<action>:<digest>:*'`, where `<digest>` is the SHA-256 of the lowercased, trimmed email, then `DEL` them. Keys hold that digest and the client address, never the email itself.

## Database migrations and seeds

Each microservice owns its Drizzle migrations and database schema under `apps/<service>/drizzle/migrations`.

### Run migrations

Migrate all services with one command (runs each service from its own directory so every database is targeted correctly):

```bash
pnpm run db:migrate
```

In containers, each service executes its compiled `node dist/migrate.js` on startup.

Identity `0003_must_change_password` adds `users.must_change_password` (default `false`). Inventory `0012_batch_creator_stocktake_counter` adds nullable `product_batches.created_by` and `stocktake_lines.counted_by`. A row without a creator is not refused by the separation-of-duties checks (BR-AUTH-009).

### Database roles

Every service connects as its own Postgres role, named after its database (`sales_service`, `payment_service`, and so on). The role owns that database and has no `CONNECT` privilege on the others, so a leaked `DATABASE_URL` exposes one service's data, not all of them. `POSTGRES_USER` is the admin account; only role setup and the chaos tooling use it.

The `postgres-roles` Compose service runs `deploy/local/postgres/roles.sh` after Postgres is healthy and before any backend service starts (`pnpm run infra:up` includes it). The script reads the passwords from `IDENTITY_DB_PASSWORD`, `CATALOG_DB_PASSWORD`, `INVENTORY_DB_PASSWORD`, `SALES_DB_PASSWORD`, `PAYMENT_DB_PASSWORD`, `OPERATIONS_QUERY_DB_PASSWORD` and `CHATBOT_DB_PASSWORD` in `.env`. It is safe to run again: it creates missing roles, resets passwords, and moves tables that an older run created as the admin user to the owning role. A stack that already holds data needs only `docker compose up -d postgres-roles`, then the services.

Migrations run as the owning role (`pnpm run db:migrate` builds each URL from the same passwords), so the tables belong to the role that uses them. On RDS, create the same roles by hand with the equivalent SQL, one secret per service as in `deploy/aws`; Terraform does not create the database tier.

### Seeds: default (A) and demo (B)

There are two seeds. They are separate commands with separate code, and neither repeats the other.

| | A. Default seed | B. Demo and reference dataset |
| --- | --- | --- |
| Command | `pnpm run seed:default` | `pnpm run seed:demo` |
| Code | `apps/identity-service/seed.mjs` | `tools/seed-demo.mjs` and `apps/identity-service/seed-demo.mjs` |
| Creates | Exactly one account: the Platform Admin `admin@pharmacycentral.vn`. Nothing else. | Product images, sites, demo accounts (manager, pharmacist, warehouse staff, shoppers), storage locations (warehouses), suppliers, products with their units of measure, opening balances, search synonyms, demo activity and 60 days of backdated sales history. |
| Password | `ADMIN_PASSWORD` in `.env` | `DEMO_ACCOUNT_PASSWORD` in `.env` |
| When | Always: on every start and release. It updates the admin by id, so repeating it is safe. | Opt-in, local only, after A. Every step skips what exists, so repeating it is safe. |
| Needs | The migrated identity database | A, the running stack, and the sites imported before the accounts (the script keeps that order). |

Business master data in production is imported through the staff import center or the catalog/inventory import APIs, not by seed B.

```bash
# A: the one admin
pnpm run seed:default

# B: the demo and reference dataset (needs the stack or pnpm dev running)
pnpm run seed:demo

# Validate without writing
pnpm --dir apps/identity-service seed -- --dry-run
pnpm --dir apps/identity-service seed:demo -- --dry-run
```

Seed A resets the admin's roles to Platform Admin on every run and touches no other account. Seed B creates one account per staff role (Pharmacy Manager, Pharmacist, Warehouse Staff) and the shoppers, each staff account holding only its role, and resets their roles and site access on every run. Site access is looked up by code from the imported sites (`SITE-RTL` for the manager and pharmacist, `SITE-WH` for warehouse staff), so `seed:demo` imports `data/import-samples/sites.csv` first and stops if a site is missing. The account list is in `docs/user-guide.md`.

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
server-side path. Dependency order matters. Images come first (uploaded by `seed:demo`, since `products.csv` carries Floci S3 URLs whose
object keys are content hashes), then sites, storage locations, suppliers, products, and finally opening balances. After
an import the truth lives in the owning service database: catalog data in `catalog-service`, stock in
`inventory-service`, images in Floci S3. Original downloads, source-verification records
(`provenance/`), and research dumps (`research/`) stay local.

Imports are idempotent on natural keys (`code`, `sku`, `batchNumber`). An opening balance row is accepted only while the batch and storage location have no stock balance or ledger history. Reimporting the same quantity is a no-op; changing an existing balance requires a stock adjustment so the ledger keeps an audit trail.

```bash
pnpm run infra:up
```

Then open `http://127.0.0.1:5302/imports` from the staff web app.

#### Local sample data (development only)

A fresh local database has no accounts and no master data. Migrations create empty tables, and sites, storage locations, suppliers, products, prices, and opening stock exist only after an import. The steps below fill all of it:

```bash
pnpm run infra:up   # infra + gateway-dev (host networking on Docker Desktop)
pnpm run db:migrate
pnpm run seed:default   # A: the one admin (needs only the identity database)
pnpm dev                # the services must be running: seed B goes through the API
pnpm run seed:demo      # B: the demo dataset, in another terminal
```

`seed:demo` runs `tools/seed-demo.mjs` and performs the steps in order. It signs in as the default admin (`admin@pharmacycentral.vn`, password `ADMIN_PASSWORD`) and stops with a pointer to `pnpm run seed:default` if that fails. It uploads the product images to Floci S3 and posts the sample CSVs from `data/import-samples/` to the same endpoints as the Data import screen. Right after the sites it creates the demo accounts (`apps/identity-service/seed-demo.mjs`), so the manager, pharmacist, and warehouse accounts get their `SITE-RTL` / `SITE-WH` access in one pass. It reuses the screen's CSV mapping from `apps/staff-web/src/import-datasets.ts`, so the two cannot drift. After the synonyms it adds demo activity through the same APIs, so the list screens have rows in every state: three transfers (waiting, in transit, received), three stock adjustments (pending, approved, rejected), three purchase orders (waiting, approved, cancelled) and fifteen orders at `SITE-RTL`. The demo shopper `khachhang@pharmacycentral.vn` owns nine of them, one in every state the customer site draws: waiting for payment, confirmed, preparing, ready, out for delivery, completed (pickup and delivery), cancelled, and refunded. Each of the six sample shoppers holds one state, so signing in as one of them shows the order page featuring only that state. Each order is placed the way checkout places it, with its payment invoice under the same id. A QR order is paid by a webhook signed with `SEPAY_WEBHOOK_SECRET`, a cash order by the counter, and the refunded one goes back through the refund endpoint. Each record has a fixed number and is skipped when it exists, and the opening balances are skipped once stock has moved, so running the script again is safe. The orders are skipped while any exist, so clear the sales and payment data before reseeding them. Each seed connection uses its own database role and `<SERVICE>_DB_PASSWORD`, as the services do. Stock rows wait for the product search index to catch up, which takes a few seconds after a product import.

Last, it creates and approves the six local search synonym groups, such as `tiêu chảy, đi ngoài, đi lỏng`. The default admin creates them, and the demo pharmacist approves them, so live search uses them from the start. Production starts with no synonym groups. Staff add them in staff-web under Search synonyms.

The final step, `tools/seed-demo-history.mjs`, makes the dataset look like a shop that has traded for two months. It receives the shop's stock through five approved purchase orders (`PO-HIST-001` to `005`) and their goods receipts (`GR-HIST-001` to `005`) with a unit cost on every line, so gross profit has real figures. It then places about 200 sales over the last 60 days, backdated one by one: counter prescriptions paid in cash, and online orders paid by SePay QR or cash on delivery, pickup or delivery, with a few cancelled and refunded. The trend charts, channel split, top products, finance entries and audit log all show those days. It also leaves, on purpose: batches of six products that expire in 6, 12, 20, 27 and 45 days and one already 8 days past expiry (`GR-HIST-EXP`), six dead-stock products with no movement for 130 days, seven prescription-only medicines and one supply that have stock but no price, five products that end the history thin against their recent sales (replenishment suggestions with a shortfall), two more replenishment requests, and carts for two shoppers. No API sets the creation time of an order or a payment, so the backdating is SQL through `docker compose exec postgres psql` (needs Docker Compose and `POSTGRES_USER` in `.env`). The step runs once: if goods receipt `GR-HIST-001` exists it adds nothing. A last step, also in that file, fills the warehouse site (`SITE-WH`, the screens of the warehouse account): three goods receipts with a cost, one purchase order waiting for approval, replenishment requests in each state, two returns, a posted and an open stocktake, and adjustments in each state. Warehouse Staff creates them and Platform Admin decides, because the manager has no access to that site. It runs once, marked by goods receipt `GR-WH-001`. The search synonym step also leaves one group (`ho khan, ho không đờm, ho rát cổ`) waiting for approval. To run the history again, use `pnpm run demo:reset` (below).

The automatic action plans are created by `inventory-service` when it starts and every 15 minutes, so restart it once after seeding (`docker compose restart inventory-service`) to get the plans for the expiring batches and the shortfalls without waiting.

This is a development tool, kept apart from production on purpose.

- It only runs from the `seed:demo` script and is not part of any image or deployment. It never creates or changes the admin: that is seed A.
- It refuses to run with `NODE_ENV=production` and refuses any `API_BASE_URL` that is not `localhost`, `127.0.0.1`, or `[::1]`.
- The sample files are fabricated coursework data. Production data is imported by an operator on the staff-web Data import screen with a real account, from the operator's own files.

Without the script, run `pnpm run seed:default`, then upload the same files by hand at `http://127.0.0.1:5302/imports`, in this order: `sites.csv`, `storage-locations.csv`, `suppliers.csv`, `products.csv`, and `opening-balances.csv`. Right after `sites.csv`, run `pnpm --dir apps/identity-service seed:demo` to create the demo accounts with their site access.

### Reset the demo data (`pnpm run demo:reset`)

Every date in the demo dataset is relative to the day it is seeded: the opening-balance expiry dates in `data/import-samples/opening-balances.csv` are written against 2026-10-29 and `seed:demo` moves each one by the days since, and the history, receipts and expiry countdowns count back or forward from the seed time. The data then ages with the clock (an expiry countdown drops by a day each day, the newest sale gets older), so reseed on the day you present.

`pnpm run demo:reset` (`tools/demo-reset.mjs`) does that in one command, in container mode: it stops the services, drops and recreates the seven service databases, removes the Typesense volume, runs `db:migrate`, starts the services (`--no-deps`, so an unhealthy Typesense does not block them), runs `seed:default` and `seed:demo`, then restarts `inventory-service` so the automatic action plans are raised against the fresh stock, and prints how many exist. It takes about three minutes. It is destructive: it refuses `NODE_ENV=production` and any `API_BASE_URL` that is not a loopback host, and needs the stack from `pnpm run stack:up` (or at least `postgres`, `rabbitmq`, `redis`, `floci` and the gateway) to be up. `pnpm run seed:demo` alone is idempotent but never refreshes the dates of data it already created; it warns when the history is a day old. The presenter's script is [Demo walkthrough](demo-walkthrough.md).

### Product images

The committed images are one file per product in `data/product-images/images/`, named `<SKU>.<ext>` (PNG, JPEG, or WebP). `pnpm run seed:demo` uploads them to the local Floci S3 bucket under the content-hash key `product-images/<SKU>/<sha256>.<ext>`, so the URL is the same for everyone and matches the `imageUrl` column of `data/import-samples/products.csv`. The upload validates every file before sending any, and the script warns about a product whose `imageUrl` was not uploaded. To add or replace an image, drop `<SKU>.<ext>` into the folder, rerun the command, and copy the new URL into `products.csv`. Original downloads and source-verification records stay local in `data/product-images/originals/` and `provenance/`. `data/` is excluded from container builds via `.dockerignore`.

### Try prescription intake

Prescription intake needs the catalog migrations `0005_text_search_extensions` (`pg_trgm` and `unaccent`) and `0006_folded_trigram_indexes` (the `catalog_fold` function and its trigram indexes), so run `pnpm run db:migrate` after pulling. Consultation requests also need the `sales-service` migration `0005_salty_trish_tilby` (the `prescription_consultations` table), which the same command applies. Import `products.csv` first, because suggestions come from the catalog.

1. Sign in to staff-web as `admin@pharmacycentral.vn`, open **AI integrations**, and save the provider, model, base URL and API key under **Prescription photo reading**. Or set all four `AI_PRESCRIPTION_READER_*` variables in `.env` (see `.env.example`), which are all or none. Until settings are saved, or the four variables are set, the photo path answers `503` and only QR intake works.
2. Sign in as the customer account and open `http://localhost:5301/gui-don-thuoc`.
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

Credentials for local development. The admin comes from the default seed (A), and its password is the `ADMIN_PASSWORD` value from `.env`. Every other account comes from the demo seed (B), and its password is the `DEMO_ACCOUNT_PASSWORD` value.

| Role | Email | Site access |
| --- | --- | --- |
| Platform Admin (seed A) | `admin@pharmacycentral.vn` | All sites |
| Pharmacy Manager | `manager@pharmacycentral.vn` | `SITE-RTL` |
| Pharmacist | `pharmacist@pharmacycentral.vn` | `SITE-RTL` |
| Warehouse Staff | `warehouse@pharmacycentral.vn` | `SITE-WH` |
| Customer | `khachhang@pharmacycentral.vn` | Customer portal |
| Customer (sample shoppers) | `nguyen.lan@example.com`, `tran.minh.khoa@example.com`, `le.thanh.huong@example.com`, `pham.quoc.viet@example.com`, `vo.ngoc.mai@example.com`, `dang.hoang.nam@example.com` | Customer portal |

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
- The authorizer validates sessions against `identity-service`, refuses an employee role that the rule table in `deploy/aws/lambda/policy.mjs` does not allow (ADR 0017), and injects HMAC-signed identity context (`x-internal-identity-context`, `x-actor-id`, `x-actor-type`, `x-request-id`), discarding any client-supplied identity headers.
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
  The outbox publisher of `identity`, `catalog`, `inventory`, `sales` and `payment` marks a row published only after the broker confirmed it,
  so a row stays unpublished while the broker is down and goes out when it is back. An advisory lock lets one
  publisher per database send at a time. Delivery is at least once. A tick reads up to 500 rows, sends them all, waits
  for the confirms together and marks them published with one UPDATE, then reads the next batch at once while rows
  remain. If the broker refuses a row, only the rows before it are marked, so the order holds and later rows go out again.
  A partial index on `occurred_at` where `published_at` is null serves the read, and once an hour a publisher deletes
  rows published more than 7 days ago.
- Audit entries use the same path. `identity-service`, `catalog-service` and `inventory-service` write an
  `<service>.audit.v1` row to their outbox after each successful write a person makes (a rule table in
  `src/modules/audit/audit-rules.ts` for catalog and inventory; explicit calls in the identity routes). The payload
  holds `action`, `entityType`, `entityId`, `siteId`, `actorId` and a few allow-listed `details`; the publisher
  copies `actorId` onto the event envelope, and `operations-query-service` projects the event into `audit_events`. The
  row is written just after the response is sent, so a crash in that gap loses the entry and a failed insert is only
  logged (`audit entry could not be recorded`). Add a route to the rule table to audit it. A request made by a system actor (a service calling another, such as the dispense that sales-service sends to inventory) is never audited at the receiving service, so a retried call cannot repeat an entry; the calling service audits its own write. `sales-service` events keep
  their own shape and now carry `actorId` in the payload where a person acted.
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

## Observability

The local stack collects traces, metrics and logs. `pnpm run infra:up` starts the `otel-collector`, `tempo`, `prometheus`, `loki` and `grafana` containers together with the rest of the infrastructure.

- `otel-collector` receives OTLP on host ports 4317 (gRPC) and 4318 (HTTP). It sends traces to Tempo, metrics to Prometheus (its OTLP receiver) and logs to Loki.
- Grafana runs at `http://localhost:${GRAFANA_PORT}` (3030 in `.env.example`). Log in with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` from `.env`. The datasources `Prometheus`, `Tempo` and `Loki` are provisioned.
- Every service requires `OTEL_EXPORTER_OTLP_ENDPOINT` and fails at startup without it. Dev mode (`pnpm dev`) uses `http://localhost:4318` from `.env`. The containers use `http://otel-collector:4318`, set in `docker-compose.yml`.
- The provisioned configuration lives under `deploy/local/`: `otel/collector.yaml`, `tempo/tempo.yaml`, `prometheus/prometheus.yml`, `loki/loki.yaml` and `grafana/provisioning/`.
- `tempo` and `loki` have no healthcheck because their images are distroless (no shell or `wget`). Check them with `docker compose logs tempo` and `docker compose logs loki`.
- Tempo and Loki keep data for 72 hours (`block_retention` and `retention_period`).
- Services push metrics once a minute, so the Prometheus datasource sets `timeInterval: 60s` and a panel needs a few minutes of traffic before `rate()` draws anything. The collector derives `traces_spanmetrics_*` and `traces_service_graph_*` from the traces, which feed the Tempo service map. HTTP calls between services (`fetch`) are traced by the undici instrumentation, so the map shows `sales-service -> inventory-service` and the like. Postgres and RabbitMQ calls appear as `unknown` nodes.

Business metrics and alerts:

- The dashboard `Pharmacy Central - Business Health` (uid `pc-business-health`) answers whether the business flows are moving. Its rows show the outbox (unpublished rows and publish lag), the queues (`.dead` depth and consumer retries), the SePay webhook outcomes, the chatbot latency and errors per step, and the delivery calculation latency.
- Business metrics reach Prometheus through the collector. Outbox metrics carry `service_name` (`inventory-service`, `sales-service`, `payment-service`):
  - `pharmacy_outbox_unpublished`, `pharmacy_outbox_oldest_age_seconds`, `pharmacy_outbox_published_total`, `pharmacy_outbox_publish_lag_seconds`.
  - Consumers: `pharmacy_consumer_messages_total{queue,outcome}` and `pharmacy_consumer_duration_seconds`. `outcome` is `processed`, `duplicate`, `retried` or `dead_lettered`.
  - Queue depth: `rabbitmq_message_current{rabbitmq_queue_name,state}` for the `.v2` queues and their `.dead` parking queues.
  - SePay: `pharmacy_payment_webhook_total{outcome}`. `outcome` is `accepted`, `duplicate`, `invalid_signature`, `invalid_payload`, `unmatched` or `error`.
  - Chatbot: `pharmacy_chatbot_step_duration_seconds{step,outcome}`. `step` is `intent_gate`, `model` or `tool`, `outcome` is `ok` or `error`.
  - Delivery: `pharmacy_delivery_calculation_duration_seconds{outcome}`, with `outcome` `ok`, `out_of_range` or `provider_error`, and `pharmacy_delivery_cache_total{result}`, with `result` `hit` or `miss`.
- The collector scrapes queue depth from the RabbitMQ management API. It needs `RABBITMQ_USER` and `RABBITMQ_PASSWORD`, which are passed to the collector container.
- Five alert rules live in the folder `Pharmacy Central`, group `pharmacy-central`, in `deploy/local/grafana/provisioning/alerting/alerts.yaml`. Each rule has `__dashboardUid__` and `__panelId__` annotations, so Grafana shows an Open dashboard link to the panel named below. The recovery steps are in [Alert runbooks](#alert-runbooks):
  - `Outbox stuck` (critical): the oldest unpublished outbox row of a service is older than 120 s for 2 minutes. Panel: Business Health, "Oldest unpublished row age (max)".
  - `Dead-letter queue not empty` (critical): a `<queue>.dead` queue holds a message for 1 minute. Panel: Business Health, "Messages in dead-letter queues".
  - `Server error rate high` (critical): more than 5% of one service's requests returned 5xx over the last 5 minutes, for 2 minutes. Panel: Service Overview, "5xx error rate by service".
  - `Consumer failures` (warning): a consumer retried or dead-lettered a message in the last 10 minutes. Panel: Business Health, "Consumer messages by queue and outcome".
  - `SePay webhook errors` (warning): the SePay webhook recorded an `error` outcome in the last 10 minutes. Panel: Business Health, "SePay webhook errors (error + invalid_payload)".
- Locally the alerts have no notification channel. View their state in Grafana under Alerting > Alert rules. Production notification wiring is a TODO for deploy.

Daily workflow:

- To find a trace, open Explore in Grafana, choose the `Tempo` datasource, and search by `service.name` (for example `sales-service`).
- To go from a log line to its trace, open Explore with the `Loki` datasource and select the `TraceID` link on a line that carries a `trace_id`. Tempo opens on that trace.
- To follow an event across services, search Tempo with `{span.messaging.system="rabbitmq"}`. The outbox row stores the `traceparent` of the request that wrote it (`outbox_messages.traceparent`, in inventory, sales and payment), and the relay publishes under it. One trace therefore runs from the request, through `publish pharmacy.events`, to every consumer's `process` span.

### Alert runbooks

Each heading below is the runbook of one alert rule.

#### Outbox stuck

What fired: the oldest unpublished row of a service in `outbox_messages` has been older than 120 s for 2 minutes (`pharmacy_outbox_oldest_age_seconds`). The relay publishes every second, so the relay or RabbitMQ is down.

First check: that RabbitMQ is up with `docker compose logs rabbitmq`, then the relay logs of the service.

Recovery: the rows stay safe in the table and drain when the broker is back. Restore RabbitMQ or the relay. The alert clears when the oldest age is back under 120 s.

#### Dead-letter queue not empty

What fired: a `<queue>.dead` queue holds at least one message for 1 minute (`rabbitmq_message_current`). Consumers could not process it.

First check: open RabbitMQ management on `http://localhost:${RABBITMQ_MANAGEMENT_PORT}`, inspect the message in `<queue>.dead`, and find the cause.

Recovery: fix the cause, then shovel the message back to `pharmacy.events` or purge it. The alert clears when the queue is empty.

#### Server error rate high

What fired: more than 5% of one service's HTTP requests returned 5xx over the last 5 minutes, with more than 0.05 requests per second (`http_server_request_duration_seconds_count`).

First check: search Tempo with `{ status = error }` and open the Service Overview dashboard.

Recovery: fix the failing path that the error traces show. The alert clears when the 5xx share is back at 5% or below.

#### Consumer failures

What fired: a queue consumer recorded a `retried` or `dead_lettered` outcome in the last 10 minutes (`pharmacy_consumer_messages_total`).

First check: the service logs, which show the attempt count for each message.

Recovery: fix the failure the logs show. A message that ended as `dead_lettered` is in a `.dead` queue, see [Dead-letter queue not empty](#dead-letter-queue-not-empty). The alert clears after 10 minutes without retries or dead letters.

#### SePay webhook errors

What fired: the SePay webhook recorded an `error` outcome in the last 10 minutes (`pharmacy_payment_webhook_total`).

First check: the payment-service logs and the SePay delivery log.

Recovery: fix the cause the logs show. The alert clears after 10 minutes without an `error` outcome.

## System page (ops-console-service)

staff-web has a System page in the Governance group. Only a Platform Admin sees it. It talks to `ops-console-service` (port 3010), which has no database and writes nothing. The page has four tabs, held in the URL as `?tab=`: Services, Messaging, API routes and Dashboards. The header (status line, refresh) stays on every tab; the window picker shows on Services only.

The tabs show:

- **Status line (header):** "all services are operating normally", or how many services are down or degraded. The verdict comes from the rules in `health.ts`: readiness and liveness probes, 5xx share, p95 latency, DB pool use and outbox lag.
- **Services tab:** one row per service with a status dot, readiness and liveness, version, instances, CPU, memory, event loop lag and a 24 h uptime strip. The window picker (15 min, 1 h, 6 h, 24 h) sets the strip. Select a row for a side sheet with the state, the reasons the verdict is not healthy, and links to the Grafana Service Overview, Traces and Logs of that service. The sheet has two tabs: Overview (the catalog) and Resources (CPU, memory and event loop lag charts with their window picker). The catalog block shows the description, database and port, the services it calls and the services that call it (a name opens that service's sheet), and the events it publishes and consumes.
- **Messaging tab, queues:** ready and unacknowledged messages, consumers and status per RabbitMQ queue. Queues without consumers and dead letter queues holding messages come first.
- **Messaging tab, search index:** documents per Typesense collection.
- **API routes tab:** the gateway path table. Each `/api` path pattern, the service it goes to, and who may call it: public, signed in, the staff roles, or Platform Admin only. A filter box narrows the rows. The table is read only.
- **Dashboards tab:** links to the dashboards. RED per service, the latency heatmap, the service graph, traces, logs, async messaging and the outbox live there, not on this page.

How the numbers come about:

- Each section of the overview fails alone: a source that is down makes only its section `unavailable`. The health grid still shows when Prometheus is down, with its version and instance facts blank.
- Saturation comes from three metrics each service pushes: `pharmacy_process_cpu_seconds_total`, `pharmacy_process_resident_memory_bytes`, `pharmacy_process_event_loop_lag_seconds`. For search-service (Go) the last one is the scheduler latency p99, not a real event loop, and memory is read on Linux only.
- The overview's load also carries the 5xx share and p95 latency (`http_server_request_duration_seconds`), the oldest outbox row (`pharmacy_outbox_oldest_age_seconds`) and DB pool use (`db_client_connection_*`). The verdict reads them; the same metrics are charted in Grafana.
- The version is the `BUILD_VERSION` build arg (`local` in `.env`, the commit sha in the release workflow), which ends up as `service_version` on `target_info`.
- Instances are counted from the memory gauge series per host over the last 5 minutes, so a container that was just replaced counts twice for up to 5 minutes.
- Uptime is `avg_over_time` of a gauge `pharmacy_ops_probe_up` that ops-console exports after probing every service each 15 s. It counts only the time ops-console itself ran, so it starts again after a restart of that service.
- Access is checked three times: the edge Lambda policy (`/api/system` is in `platformAdminPaths`), the service (HMAC-verified identity context, role `Platform Admin`, employee), and the staff-web menu.
- Required environment (no defaults): `PORT`, `INTERNAL_IDENTITY_SECRET`, the eight `*_SERVICE_URL`, `PROMETHEUS_URL`, `RABBITMQ_MANAGEMENT_URL`, `RABBITMQ_MANAGEMENT_USER`, `RABBITMQ_MANAGEMENT_PASSWORD`, `TYPESENSE_URL`, `TYPESENSE_API_KEY`, `GRAFANA_PUBLIC_URL`.
- The page is read only: no replay of dead letters, no reindex.
- The service catalog (`GET /api/system/catalog`) and the route table (`GET /api/system/routes`) are constants of the service, in `src/modules/system/service-manifest.ts`, `probed-services.ts` and `route-table.ts`. The service reads nothing from `deploy/` at runtime. When a gateway path, a platform-admin path, an ALB rule or a service dependency changes, change the table or the manifest too. `route-table.test.ts` fails when `deploy/local/gateway/routes.conf`, `deploy/aws/main.tf` or `deploy/aws/lambda/policy.mjs` disagree with the table. `service-manifest.test.ts` checks that every probed service has an entry, that every `dependsOn` names a known service, that every consumed event is published, and that every runbook anchor is a heading of this file. The dependencies and events come from the code (`*_SERVICE_URL` use, `fetch` calls, outbox writes, queue bindings), so update them when those change.
- **Limits on AWS:** Amazon Managed Prometheus accepts only SigV4-signed queries and `ops-console-service` does not sign, so the overview's load numbers need a signing proxy (for example `aws-sigv4-proxy`) in front of the workspace and `PROMETHEUS_URL` pointing at it. The RabbitMQ section needs the management endpoint of Amazon MQ, which was not tested.

### Grafana bookmarks for the System page

The System page keeps only what Grafana cannot show: the health verdict, the services table (status, version, instances, CPU, memory, event loop lag, uptime), the queues and the search index. The rest is in the provisioned Grafana dashboards under the folder `Pharmacy Central`.

| Removed from the System page | Where in Grafana |
| --- | --- |
| Requests per second, 5xx share, p95 and DB pool per service; KPI tiles; traffic chart | Service Overview (uid `pc-service-overview`): rows Traffic and errors, HTTP server latency and Database client. The Service variable filters to one service. |
| Latency heatmap | Service Overview, row Latency heatmap (panel Request duration buckets). Full screen: `/d/pc-service-overview?viewPanel=panel-19`. |
| Service map and its RED table | Service Overview, row Service map (node graph and RED table from the Tempo `serviceMap` query). Explore, Tempo, query type Service Graph gives the same view. |
| Traces tab | Explore, Tempo, TraceQL: `{ nestedSetParent < 0 && (kind = server || kind = consumer) && span.url.path !~ "/health.*" }`. Add `resource.service.name = "<service>"` inside the braces for one service. |
| Logs tab | Explore, Loki: `{service_name=~".+"}`, or `{service_name="<service>"}` for one service. Service Overview also has a Logs panel. |
| Outbox lag card | Business Health (uid `pc-business-health`), row Outbox. |
| Traces and logs of one service (System page Sheet links) | The same Explore queries as above, with the service filled in. Service Overview with `var-service=<service>` is the RED view. |

Queues stay on the System page, and Business Health (row Consumers and queues) has the depth over time, consumer errors and dead letters. Async messaging spans and broker logs are in Async Messaging (uid `pc-async-messaging`).

**Start here.** The dashboard `Pharmacy Central - Start here` (uid `pharmacy-start`, file `deploy/local/grafana/dashboards/start-here.json`) has the table above with working links. It is the home dashboard: `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH` in the `grafana` service of `docker-compose.yml` points to it. Open Grafana at `http://localhost:${GRAFANA_PORT}` (3030 in `.env.example`) and sign in with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`. Each Pharmacy Central dashboard also has a `Start here` link at the top.

**Service graph filter.** The OTel collector (`deploy/local/otel/collector.yaml`) sends `/health*` spans to Tempo and span metrics, but not to the service graph pipeline (`filter/health_probes`). Docker healthchecks and the probes of `ops-console-service` would otherwise draw a `user` or ops-console edge to every service. Edges already in Prometheus fade out of a 1 h view within the hour.

## Self-hosted product search embeddings

Semantic product search needs a text-embedding model. The default is the `embedder` service of Compose: HuggingFace text-embeddings-inference on CPU, model `intfloat/multilingual-e5-small` (384 dimensions), ONNX weights. `pnpm run infra:up` and `pnpm run stack:up` start it with the rest of the infrastructure, so search needs no quota and no key from a provider. The first start downloads the model into a volume (about 2 minutes here), and until it is healthy search matches keywords only.

`.env` holds the settings that `catalog-service` reads (`.env.example` has them ready): `AI_EMBEDDING_PROVIDER=openai-compatible`, `AI_EMBEDDING_BASE_URL=http://localhost:8109/v1`, and `AI_EMBEDDING_MODEL` and `AI_EMBEDDING_API_KEY` equal to `EMBEDDER_MODEL` and `EMBEDDER_API_KEY`. The container stack ignores the base URL and calls `http://embedder:80/v1`, like it does for Typesense. A Platform Admin can still save other settings in staff-web (AI integrations); saved settings win over `.env`, and a saved base URL must be https. `search-service` reads the same four variables and cannot see the saved settings, so its values must match those of `catalog-service` (see the search service section).

To use Gemini instead, set the provider to `gemini`, the base URL to `https://generativelanguage.googleapis.com`, the model to `gemini-embedding-001` and your key, and change the `AI_EMBEDDING_BASE_URL` of `catalog-service` in `docker-compose.yml` back to `${AI_EMBEDDING_BASE_URL}`. Restart `catalog-service`: it reindexes every product, because the model name is part of the content hash.

- E5 models need a role prefix on every text. The adapter adds `query: ` and `passage: ` when the model name contains `e5`.
- Queries of fewer than three words (`SEMANTIC_MIN_WORDS`) are searched by keywords only and never embedded: they are the queries shoppers repeat, and the keyword fields cover them. Vector-only hits are cut at a cosine distance that depends on the model: 0.15 for E5 (measured on multilingual-e5-small: relevant hits 0.09 to 0.16, unrelated queries 0.17 and up) and 0.35 for Gemini. A model without a measurement gets 0.35, which is uncalibrated for it. Measure the distances of relevant and nonsense queries before trusting a new model.
- Measured on multilingual-e5-base, container limited to 2 CPUs and 2 GB: a warm query took 26 to 41 ms (the first one 295 ms), 32 documents 1.1 s, and memory 1.6 GB. multilingual-e5-small, on an otherwise idle machine, 16 concurrent new queries with the image's default settings: 97 requests a second on 1 CPU, about 210 on 2 and 226 on 4 (the 4-CPU figure may be capped by the single-process benchmark client), one query alone 10 ms. The same container started with `--max-batch-tokens 4096 --tokenization-workers 2` measured 54, 105 and 224: those two flags halved the throughput at 2 CPUs and were removed. `catalog-service` also keeps the last 5,000 query vectors in memory.
- Do not mix models. Vectors from two models are not comparable, so wait for the reindex to finish after a model change. Until then search can return odd hits.
- If the embedding provider fails, products are still indexed for keyword search and the sweep retries with a growing delay (30 s up to 15 minutes). Search itself falls back to keywords when the query cannot be embedded.

### On AWS

`deploy/aws` runs the same embedder as its own ECS Fargate service, `embedder`. It is internal: catalog-service and search-service reach it through Cloud Map at `http://embedder.<environment>.pharmacy.internal:80/v1`. No ALB rule and no API Gateway route exposes it, and its security group accepts port 80 only from the catalog-service and search-service tasks. Terraform sets the four `AI_EMBEDDING_*` variables on catalog-service and search-service; a setting saved in staff-web still overrides them on catalog-service only. The `https` rule for base URLs applies to URLs saved in staff-web, so it does not block the internal `http` URL.

1. **Build and push the image.** `deploy/embedder/Dockerfile` builds on the pinned text-embeddings-inference CPU image and copies in `intfloat/multilingual-e5-small` at the pinned revision. Push it to the registry the backend images use, and take the digest:

   ```bash
   docker build -t <registry>/pharmacy-central/embedder:<tag> deploy/embedder
   docker push <registry>/pharmacy-central/embedder:<tag>
   docker inspect --format '{{index .RepoDigests 0}}' <registry>/pharmacy-central/embedder:<tag>
   ```

   Set the digest reference as `embedder_image`. Rebuild when the model revision changes, and not otherwise.
2. **Create the secret.** Store the API key in Secrets Manager and pass its ARN as `embedder_api_key_secret_arn`. The embedder task reads it as `API_KEY`, and catalog-service reads the same secret as `AI_EMBEDDING_API_KEY`. The value never goes into tfvars or code:

   ```bash
   aws secretsmanager create-secret --name pharmacy-central/staging/embedder-api-key --secret-string "$(openssl rand -hex 32)"
   ```

3. **Variables.** `embedder_image` and `embedder_api_key_secret_arn` are required. `embedder_task_cpu` (2048) and `embedder_task_memory` (4096 MiB) are a valid Fargate pair; the model measured about 1.7 GiB.
4. **Why one task, without autoscaling.** When the embedder is down, catalog search falls back to keywords, so a second replica adds little, and each task costs 2 vCPU and 4 GiB. A deployment starts the new task before it stops the old one, so the old task keeps answering until the new one is healthy.
5. **Why the model is baked in.** A Fargate task has no persistent volume. With the Compose volume, every start, and every replacement task, would download about 1.1 GB from Hugging Face before it could answer. The image carries the model, and the task runs with `HF_HUB_OFFLINE=1`, so it never reaches the network for the model.
6. **Check it.** The first start takes minutes while the ONNX model loads, so give the task about five minutes after a deployment:

   ```bash
   aws ecs describe-services --cluster pharmacy-central-staging --services pharmacy-central-staging-embedder \
     --query 'services[0].{desired:desiredCount,running:runningCount}'
   aws ecs describe-tasks --cluster pharmacy-central-staging --tasks <task-arn> --query 'tasks[0].healthStatus'
   aws logs tail /ecs/pharmacy-central-staging/embedder --since 15m
   ```

   The health status must be `HEALTHY`, and the log must end with `Ready`. The container health check calls `GET /health` on port 80, so an unhealthy state in the logs is the first place to look.
8. **Check the fallback.** Stop the embedder and confirm that search still answers from keywords:

   ```bash
   aws ecs update-service --cluster pharmacy-central-staging --service pharmacy-central-staging-embedder --desired-count 0
   ```

   Run a storefront product search and expect a normal answer, with keyword matches only. Then restore the task with `--desired-count 1`. The next `terraform apply` also restores it, because the Terraform value is `1`.

## Product search service (Go)

`search-service` is the read path of `GET /api/products`, the product list and browse route. It is a Go service (`apps/search-service`, port 3009) that answers only that route. Every other `/api/products*` path, such as `GET /api/products/{id}`, `POST /api/products/imports` and the unit routes, stays on `catalog-service`. The answers are the ones `catalog-service` gives for the same request: the same query parameters (`search`, `category`, `prescriptionRequired`, `limit`, `cursor`), the same product objects with `units`, the same `X-Next-Cursor` header, and the same `400` problem body for an invalid query. `GET /healthz` answers `200 ok`.

What it does for a list request:

- It reads only Typesense, never PostgreSQL. Each Typesense document carries a `payload` field with the JSON that `catalog-service` would return for that product. The service asks Typesense for that field only and joins the payloads into the response array without decoding or re-encoding them.
- A query of fewer than three words is answered by keywords only and is never embedded. A longer query is embedded through `AI_EMBEDDING_BASE_URL` with the `query: ` prefix when the model name contains `e5`. Vector hits are cut at a cosine distance of 0.15 for E5 models and 0.35 otherwise, as in `catalog-service`.
- The whole answer is cached for 30 seconds, up to 5,000 entries, per normalised search (lower-cased, whitespace collapsed), category, `prescriptionRequired`, limit and offset. Concurrent identical requests share one load. The last 5,000 query vectors are kept in memory.

Fallback chain:

1. The embedder fails or times out (3 s): the query is answered from keywords only, and the request succeeds.
2. Typesense fails, times out (2 s), or the collection is missing: the original request is proxied to `CATALOG_SERVICE_URL`, and `catalog-service` answers it, falling back to PostgreSQL itself. The service logs a warning.

Typesense index:

- The collection is `catalog_products_v3`. Its documents keep every field of the previous collection and add `payload` (a string, not indexed for search). The `sku` field is sortable. Only active products are indexed, which is the set `GET /products` may return.
- Deploying this change triggers one full reindex and re-embedding of the products. Until the new collection is complete, a missing collection sends requests to `catalog-service`.
- The display data lags the database by one sweep, plus the 30 second response cache. A product that the sweep removes, because it was deactivated, leaves the results at that sweep.
- `catalog_products_v2` is no longer used. Once `catalog_products_v3` answers, delete it with the Typesense API:

  ```bash
  curl -X DELETE "$TYPESENSE_URL/collections/catalog_products_v2" -H "X-TYPESENSE-API-KEY: $TYPESENSE_API_KEY"
  ```

Environment variables. The service reads each one without a default, and it exits at startup with an error that names the missing variable:

| Variable | Meaning |
| --- | --- |
| `PORT` | The listen port, 3009 in Compose. |
| `TYPESENSE_URL` | The Typesense base URL, `http://typesense:8108` in Compose. |
| `TYPESENSE_API_KEY` | The Typesense API key. |
| `CATALOG_SERVICE_URL` | The fallback upstream, `http://catalog-service:3002` in Compose. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The OTLP HTTP endpoint of the collector. The standard `OTEL_EXPORTER_OTLP_*` variables apply too. |
| `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_BASE_URL`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_API_KEY` | All or none. `openai-compatible` is the only provider. With none set, search is keyword only. A partial group, or another provider, stops the service at startup. |

The embedding group must equal the one `catalog-service` uses. Settings saved in staff-web (AI integrations) live only in the database of `catalog-service`, and `search-service` cannot read them. If a Platform Admin saves different embedding settings in staff-web, give `search-service` the same four values and restart it. Otherwise the query vectors and the product vectors come from different models.

Local run: `pnpm dev` starts `search-service` through Nx, with the `dev` target of its `project.json`, on the port of `SEARCH_PORT` (3009). The `go` command must be on the `PATH`, and the Go toolchain must be 1.26 or newer. Without it, the `dev` target fails. The local gateways send `GET /api/products` to it, like the AWS ALB.

Metrics, exported over OTLP with the service name `search-service`:

- `pharmacy.search.cache`, with `outcome` `hit`, `miss` or `shared`, counts the response cache. In Prometheus it appears as `pharmacy_search_cache_total{outcome}`.
- `pharmacy.search.embedding_cache`, with the same `outcome` values, counts the query-vector cache. In Prometheus it appears as `pharmacy_search_embedding_cache_total{outcome}`.

Measured capacity: see below.

### Measured capacity of search-service

Test: `search-users.js`, 1,000 users, no think time, 2m25s, container stack on one workstation. `search-service` ran as one replica limited to 1 vCPU and 1 GiB (the container could use two host cores, but the quota was 1 vCPU, same CPU time as the Node baseline). Embedder 2 vCPU, Typesense 4 vCPU, k6 on its own cores. One run per row.

| | catalog-service (Node), run A | catalog-service (Node), run B | search-service (Go) |
| --- | --- | --- | --- |
| Requests per second | 387 | 296 | 1,505 |
| p95 | 4.54 s | 5.38 s | 3.28 s |
| p99 | not recorded | not recorded | 3.54 s |
| Median | not recorded | not recorded | 183 ms |
| Failed requests | 0 | 0 | 0 of 219,610 |
| CPU of the service | 92–97% of 1 vCPU | 92–97% of 1 vCPU | 100% of 1 vCPU |
| Memory | not recorded | not recorded | 192 MiB at most |

Other containers during the Go run: embedder 199% of its 200% limit, Typesense 64% on average (90% at most), catalog-service 2% (fallback upstream, not used). The service logged no fallback to catalog-service.

Reading: on the same 1 vCPU the Go service answers about 4 to 5 times more requests per second than the Node service. It still does not meet the target `p(95)<500 ms` at 1,000 users with no think time: that load is about 1,500 req/s, above what one vCPU serves. The embedder is also saturated, so it limits queries that need a vector. To meet the target at this load, add `search-service` replicas (the CPU is the limit) and size the embedder. The 1,000-user rows with think time 15 s and 30 s were not re-run on `search-service`.

Caveats: single runs, run-to-run spread about 25%; k6, Prometheus and the other containers share one workstation; the Node runs were measured before the Go container was pinned to two host cores; the Node runs used the embedder at 2 vCPU too, which was near its limit in run B.

## Load and chaos testing

Load tests run with k6, chaos tests with a Node runner that injects one fault at a time under a steady checkout load. Both are local tools, never part of a container image. Run them against the **container stack** (`pnpm run stack:up`): under `pnpm dev`, `node --watch` restarts services and leaves stale keepalive connections in the gateway, which shows up as 60 s stalls that are not application problems.

k6 runs as the Compose service `k6` (profile `loadtest`, image pinned by digest), so nothing is installed on the host. It pushes its results to Prometheus remote write; Grafana shows them in the dashboard `Pharmacy Central - Load Test` (uid `pc-load-test`), next to the server-side latency, outbox, queue and database panels. Set `LOAD_TARGET_URL` in `.env`: `http://gateway:8080` for the container stack, `http://host.docker.internal:8080` when the services run under `pnpm dev`.

```bash
# k6 flags go before the script path. PROFILE is smoke (one iteration), load (10 VUs, 2 minutes) or stress (50 VUs, 3 minutes).
pnpm run load -e PROFILE=smoke /scripts/scenarios/checkout.js
pnpm run load -e PROFILE=load /scripts/scenarios/checkout.js
```

| Script (`tools/k6/scenarios/`) | What it checks |
| --- | --- |
| `checkout.js` | Browse, order, invoice, SePay webhook, paid. Thresholds: failed requests under 1%, `POST /orders` p95 under 1.5 s, order to paid p95 under 8 s. Setup adds opening stock under a unique batch number, only for products the search index resolves. |
| `browse.js` | Storefront reads and Vietnamese search (typos, synonyms, empty result). Search p95 under 400 ms. |
| `search.js` | Product search capacity at one fixed request rate (`-e RATE=<req/s>`), with `-e QUERIES=cached` or `mixed` (most queries need a new embedding). Thresholds: search p95 under 500 ms, under 1% failed, no dropped iterations. A 40 s warm-up runs first and is not measured. |
| `oversell.js` | 60 orders from 30 VUs for 20 units of stock. Stock never goes negative or oversold, prices come from the server, absurd and negative quantities are refused. |
| `chatbot.js` | Product question, out-of-scope refusal by the intent gate, follow-up, and the per-customer rate limit (10 questions a minute). It calls the real AI provider, so the calls per profile are capped. |
| `prescription-intake.js` | Photo upload limits (8 MB, MIME mismatch), clean 429 with `Retry-After`. Calls the real reader, capped. |
| `imports.js` | Product and opening-balance imports through the API, and the time until a new SKU is searchable. |

The AI scripts spend provider quota. A customer may send 30 prescription photos in a rolling 24 hours, so keep the `smoke` profile for those two scripts. Product imports also call the embedding provider once per changed product.

Chaos scenarios (`tools/chaos/scenarios/`) each start a checkout load, inject the fault, restore everything in a `finally` block (and on Ctrl-C), and then assert data invariants through PostgreSQL, the RabbitMQ management API, Prometheus and the Grafana alert states.

```bash
pnpm run chaos rabbitmq-outage          # one scenario; "all" runs every one, about 25 minutes
pnpm run chaos all --dry-run            # reads only: checks the helpers and queries, injects nothing
```

| Scenario | Fault | Expected outcome |
| --- | --- | --- |
| `rabbitmq-outage` | RabbitMQ stopped for 60 s | Orders and reads keep answering; the outbox backlog grows and drains; every event is published and applied exactly once; `.dead` queues stay empty. |
| `poison-message` | Three malformed events published to `pharmacy.events` | They land in the bound `.dead` queues and nowhere else; consumers carry on; `Dead-letter queue not empty` fires. The runner purges only its own messages. |
| `redis-outage` | Redis stopped for 45 s | Pickup checkout is unaffected; photo intake answers `503 rate_limit_unavailable`; no 5xx storm. |
| `typesense-outage` | Typesense stopped | Search answers within its budget; detail, availability and orders stay 200; search works again after the restart. |
| `payment-outage` | payment-service stopped | The webhook is refused while down; replaying it after the restart creates exactly one transaction and one paid invoice. |
| `sales-kill` | `SIGKILL` on sales-service under load | No order without lines, no reservation drift, no stranded outbox row, checkout recovers. |
| `ai-provider-outage` | Chat model and intent gate fail (slow, hung, 500, 429, malformed, truncated) | A clean `503 assistant_unavailable` inside the provider timeout (30 s model, about 12 s gate), unrelated endpoints stay fast, the question is answered again after recovery. |
| `ai-reader-outage` | Prescription reader fails the same ways | A clean `502 reader_failed` inside the 45 s timeout, then the photo is read again. |

The two AI scenarios never call a real provider. `ai-provider-outage` starts two copies of `tools/mock-ai-server.mjs` (needs `MOCK_AI_PORT`; modes `ok`, `slow`, `hang`, `error500`, `error429`, `malformed`, `truncated`, switched with `POST /__mode`) on ports 5390 and 5391, and recreates `chatbot-service` with `AI_CHATBOT_*` and `AI_INTENT_GATE_*` pointed at them; `ai-reader-outage` does the same on port 5392 for `sales-service` and `AI_PRESCRIPTION_READER_*`. Compose reads process variables before `.env`, so `.env` and the saved credentials stay untouched; the runner recreates the service with the real settings at the end. The containers must reach `host.docker.internal`; if a firewall blocks it, the first check fails and the run stops before injecting anything.

`ai-reader-outage` sends 8 photos as the demo customer. The intake limiter allows 5 a minute and 30 a day, and it counts photos that reach the reader even when the read fails. When the scenario stops at its first check with `429`, wait, or clear the day counter of the demo customer: `docker compose exec redis redis-cli DEL sales:prescription-intake:day:<customer id>`.

### Capacity on an ECS-sized stack

`pnpm run stack:aws-like` layers `docker-compose.aws-like.yml` over the container stack and sizes it like `deploy/aws`: every backend service runs 2 replicas of 0.5 vCPU and 1 GiB (the `task_cpu`, `task_memory` and `desired_count` defaults), except `sales-service`, which runs 1 vCPU and 2 GiB (`sales_task_cpu`, `sales_task_memory`: it takes every order and runs its outbox relay, and was the first container at its CPU cap in the checkout test), and the gateway balances between them. Terraform defines no data tier, so PostgreSQL (2 CPUs, 4 GB), Redis (1, 1 GB), RabbitMQ (1, 2 GB) and Typesense (2, 4 GB) are assumptions you should replace with the sizes you choose. Autoscaling is not modelled: this is the floor of two tasks. Host ports of the services are closed in this mode; everything goes through the gateway. Return to the plain stack with `pnpm run stack:down`.

```bash
node --env-file=.env tools/bulk-products.mjs add 10000     # synthetic BULK-nnnnnn products; waits until the search index holds them
pnpm run load -e PROFILE=breakpoint /scripts/scenarios/checkout.js   # steps 20 to 300 VUs, a minute each
node --env-file=.env tools/bulk-products.mjs remove 10000  # deactivates them again
```

The `breakpoint` profile stops itself when more than 5% of requests fail or the `POST /orders` p95 passes 3 s (checked after 40 s). Measured on one 16 GB workstation with k6 and the observability stack on the same machine, 10,120 products in the index:

| Measurement | Result |
| --- | --- |
| Import of 10,000 products | 102 s through the API (40 requests of 250, median 2.6 s) |
| Search index complete | 17 minutes after the first import, about 11 documents a second; the cause was not isolated (catalog-service at 0.5 vCPU, or the embedder) |
| Search, warm / first time a query is seen | 12 to 72 ms / 500 to 630 ms (the embedding call) |
| Browse load, 10 iterations/s for 2 minutes | 0 failures in 5,499 checks, search p95 68 ms, list p95 17.7 ms |
| Checkout breakpoint, run 1 | all 300 VUs reached; 117,717 requests at 186 req/s, 0.04% failed, `POST /orders` p95 2.43 s |
| Checkout breakpoint, run 2 | stopped at 275 VUs by the 3 s gate (`POST /orders` p95 3.0 s) |

Throughput stopped growing at about 60 VUs: 199 req/s there against 218 req/s at 300 VUs, about 14 completed checkouts a second. Past that point extra VUs only add waiting. Sampled during the second run, the containers at their limits were `sales-service` (both replicas at about 50% of one core, the 0.5 vCPU cap), PostgreSQL (113% to 160% of its 200%), and RabbitMQ in bursts (100% of its 1 CPU). In run 1, 35% of the orders were not marked paid within the script's wait, so the payment-to-order path fails first, long before requests fail: order to paid p95 was 14 s over the run. These percentiles are for the whole run, not per step. Adding tasks (autoscaling) helps `sales-service`, but the data tier then limits next.

**Outbox relay and sales-service size, measured.** The same breakpoint ramp again after the relay sent 500 rows per batch with one confirm wait and one UPDATE (it sent one row at a time, 50 a tick), an index on the unpublished rows, and `sales-service` at 1 vCPU and 2 GiB. One run each, same stack:

| Measurement | Before | After |
| --- | --- | --- |
| Oldest unpublished outbox row (payment / sales) | 28 s / 208 s | 1 s / 1 s |
| Unpublished rows at the peak (payment / sales) | 725 / 6,347 | 29 / 16 |
| Order to paid p95 | 13.8 s | 14.7 s |
| `POST /orders` p95 | 2.2 s | 3.0 s (the 3 s gate stopped the run at 8 min 40 s; the first run finished all 300 VUs) |
| PostgreSQL CPU | 160% to 205% of 200% | 196% to 208% of 200%, from about 100 VUs on |

The relay backlog is gone, but the checkout did not get faster, so the relay was not what limited the order to paid time. With `sales-service` no longer capped, more work reached PostgreSQL, which sat at its 2 CPU limit, and `POST /orders` got slower.

**Missing indexes, found with `pg_stat_statements` and fixed.** One ramp with `pg_stat_statements` on showed two statements using 87% of all query time: `select ... from order_lines where order_id = $1` in sales (999 s, 27 ms each, 68%) and `select ... from payment_invoice_lines where payment_invoice_id = $1` in payment (285 s, 29 ms each, 19%). Neither column had an index, so each call read all 83,000 rows (`order_lines`: 413,223 sequential scans, 20 billion rows read, no index scan). `stock_reservation_lines.reservation_id` had the same gap. The three indexes bring the sales query from 5.9 ms to 0.16 ms in `EXPLAIN ANALYZE`. The same ramp after the indexes and the per-service database roles, one run each:

| Measurement | After relay and sizing change, before indexes | After indexes |
| --- | --- | --- |
| Run | stopped at 8 min 40 s by the 3 s gate | all 300 VUs, 10 min |
| Checkouts per second | 12.6 | 26.0 (15,929 done) |
| `POST /orders` p95 | 3.01 s | 1.03 s |
| Order to paid, average / p95 | 5.2 s / 14.7 s | 4.3 s / 11.5 s |
| Orders not paid within the 15 s wait | 25% (1,302 of 5,125) | 1.3% (164 of 12,717) |
| Failed HTTP requests | 0.20% | 0.00% (3 of 183,813) |
| PostgreSQL CPU, average / peak (200% limit) | 160 to 205% | 134% / 188% |
| `sales-service` CPU per replica (1 vCPU) | not recorded | 86 to 88% average, 101% peak |

The checkout is no longer limited by PostgreSQL. `sales-service` is back at its 1 vCPU limit, which is the next likely limit; that was not measured further. Order to paid still takes 11.5 s at p95 at the top of the ramp. Not yet explained. The PostgreSQL here runs with its stock settings (`shared_buffers` 128 MB), so the figures are for an untuned database.

**Search capacity** (`search.js`, `limit=60` as customer-web asks, 10,120 products, same ECS-sized stack, each rate run after the previous backlog had drained). The first measurement found an N+1: after the search, `catalog-routes.ts` read the units of each result with its own query, about one PostgreSQL query per result. `DrizzleStoreRepository.listUnitsByProductIds` now reads them for the whole page in one query, in `GET /products` and `POST /products/match`. Ten searches at `limit=60` went from about 500 PostgreSQL transactions to about 20, and the median search at `limit=60` from 91 ms to 26 ms.

| Rate | p95 before, cached queries | p95 after, cached queries | p95 after, mixed queries |
| --- | --- | --- | --- |
| 20 req/s | 140 ms | 34 ms | 71 ms |
| 25 req/s | 1.2 s (fails) | not run | not run |
| 30 req/s | 4.1 s (fails) | 35 ms | 90 ms |
| 40 req/s | not run | 70 ms | 292 ms |
| 50 req/s | not run | 101 ms | 447 ms |
| 60 req/s | not run | 150 ms | 623 ms (fails) |
| 80 req/s | not run | 787 ms (fails) | 7.3 s (fails) |
| 100 req/s | not run | 2.25 s (fails) | not run |

Search now holds about 60 requests a second when the query vectors are cached and about 50 when most queries need a new embedding, three times and two and a half times the 20 before the fix, with the p95 under 500 ms. The mixed runs fail earlier because every new query costs one embedder call. If a visitor searches once every 10 seconds, 50 requests a second is about 500 people at the same moment; that ratio is an assumption, not a measurement. The limit that remains was not isolated: the replicas of `catalog-service` are capped at 0.5 vCPU, so more or larger tasks raise it.

A virtual user here checks out continuously. A shopper checks out once in many minutes, so read the result as throughput (about 14 checkouts a second at the floor size), not as a number of people.

**Search on one container (1 vCPU, 1 GiB), 1,000 users.** One `catalog-service` container limited with `docker update --cpus 1` (memory 1 GiB), the other services at 2 × 0.5 vCPU, mixed queries, `limit=60`, 5,120, 10,120 and 15,120 products in the index. `search.js` holds a fixed rate; `search-users.js` holds 1,000 concurrent shoppers who search, then wait `THINK` seconds (±50%), so the request rate is about 1,000 / `THINK`. The p95 gate is 500 ms and no run had failed requests: a run fails by getting slow.

| Test | 5,120 products | 10,120 products | 15,120 products |
| --- | --- | --- | --- |
| 20 req/s, p95 | 119 ms | 96 ms | 71 ms |
| 30 req/s, p95 | 167 ms | 160 ms | 71 ms |
| 40 req/s, p95 | 285 ms | 250 ms | 100 ms |
| 50 req/s, p95 | 1.86 s (fails) | 1.08 s (fails) | 263 ms |
| 60 req/s, p95 | not run | not run | 604 ms (fails) |
| 80 req/s, p95 | not run | not run | 5.03 s (fails) |
| 1,000 users, think 30 s (about 33 req/s), p95 | 223 ms | 273 ms | 418 ms |
| 1,000 users, think 15 s (about 67 req/s), p95 | 2.15 s (fails) | 1.97 s (fails) | 5.17 s (fails) |

One container holds 40 to 50 req/s, so 1,000 users fit when they search about every 30 seconds and do not fit when they search every 15 seconds. The ceiling in users is about 40 to 50 req/s times the seconds between searches (1,200 to 1,500 users at 30 s, 600 to 750 at 15 s). Where it fails, the catalog container is at 80% of its core on average and touches 100%, and Typesense (2 CPUs) is at 120% to 160%; memory never passed 225 MiB of 1 GiB. Each rate was run once on a workstation that also runs k6, Prometheus, Grafana and the embedder, and the p95 at 20 to 50 req/s is lower at 15,120 products than at 5,120: run-to-run variation is larger than the effect of catalog size here, so these runs do not show how latency grows with the catalog. They show that memory is not the limit. These runs did not sample the embedder; the next run, below, found it saturated.

**What changed after that, and one more run at 50 req/s.** `GET /products` now pages with `cursor` (see the API guide), the catalog keeps whole list answers for 30 seconds (an LRU of 5,000 pages, concurrent identical requests share one load, and a product change through the replica clears it), and the local container got more CPU: `catalog-service` 2 vCPU and 1 GiB, Typesense 4 CPUs, set with `docker update --cpus` on the running containers (Terraform is unchanged). The run: 10,120 products, one catalog container, `search.js` at 50 req/s with pages of 20, one request in five for the second page, and 30% one-off queries that no cache has seen.

| Measurement during the 60 s | Result |
| --- | --- |
| Search p95 / median / p99 | 1.19 s (fails) / 338 ms / 1.42 s; no failed request, no dropped iteration |
| `catalog-service` CPU | 57% of its 2 vCPU on average, 81% at most; memory 385 MiB |
| Typesense CPU | 42% of its 4 CPUs on average |
| **Embedder CPU** | **194% of its 2 CPUs on average**: saturated |
| Response cache | about one lookup in five was a hit (counter `pharmacy.search.cache`, taken over a window that included a second run): the 1,200 popular queries and 2 pages are too many to repeat within 100 s |

The search failed because of the embedder, not the catalog or Typesense. Every query that is not in a cache is embedded, 40 or so a second here, and the embedder's two CPUs are at their limit. The earlier sweeps did not sample the embedder, so their conclusion that the catalog container's CPU was the limit is not proven.

**Embedder at 4 CPUs, vector cache of 5,000.** The same run again with the embedder limited to 4 CPUs and 4 GB and the query-vector cache raised from 500 to 5,000 entries (about 30 MB for 768 dimensions):

| Measurement | Embedder 2 CPUs, cache 500 | Embedder 4 CPUs, cache 5,000 |
| --- | --- | --- |
| Search p95 | 1.19 s (fails) | 602 ms (still over 500 ms) |
| Median / p99 | 338 ms / 1.42 s | 73 ms / 1.30 s |
| Embedder CPU | 194% of 200% | 373% of 400%, peaks at 403% |
| Query-vector cache (`pharmacy_search_embedding_cache_total`) | not counted | 537 hits, 1,941 misses |
| Response cache (`pharmacy_search_cache_total`) | about 1 in 5 hits | 563 hits, 2,478 misses |

**multilingual-e5-small, queries of fewer than three words not embedded, Zipf traffic.** The index was rebuilt with multilingual-e5-small (384 dimensions, collection `catalog_products_v2`), queries under `SEMANTIC_MIN_WORDS` (3) went keyword-only, and `search.js` was changed to draw its 1,200 popular queries by a Zipf law (shorter ones more often) with 15% one-off queries. The run: 50 req/s, 10,120 products, one catalog container (2 vCPU), embedder 4 CPUs.

| Measurement | Result |
| --- | --- |
| Search p95 / p99 / median | 1.45 s (fails) / 1.85 s / **10.7 ms** |
| Failed requests / dropped iterations | none / none |
| `catalog-service` CPU / event loop busy | 43% of 2 vCPU / 29% |
| Response cache | 1,129 hits, 1,120 misses (50%), 4 shared |
| Query-vector cache | 62 hits, 698 misses |
| Embedder, per request in the window | inference p50 113 ms, **queue wait p50 916 ms (p95 1.53 s)**, 14 requests a second |

Half of the requests are answered without the embedder and take milliseconds; the rest, the new queries of three words or more, wait about a second in the embedder's queue. The embedder alone does far better than it did under load: on the same machine with nothing else running it served about 210 new queries a second at 2 CPUs and 226 at 4 (see Self-hosted product search embeddings; the figures of this run used the removed `--max-batch-tokens 4096 --tokenization-workers 2` flags, with which the same machine gave 105 and 224), and a single query takes 10 ms, against an inference time of 113 ms in the run. The run was therefore limited by the workstation, which runs k6, 13 service containers, Typesense (4 CPUs), the embedder (4 CPUs), Postgres, the observability stack and the browser on 16 logical cores, with CPU limits that add up to more than the machine has. ONNX threads that cannot get a core wait in the queue. Treat the 1.45 s as a floor for this machine, not as a capacity of the design; a faithful number needs the load generator and the embedder on separate hosts, or at least the embedder pinned to its own cores.

**Same run with each container pinned to its own cores.** No second machine is needed: on the 16 logical cores of the workstation the embedder got cores 0 to 3, Typesense 4 to 7, `catalog-service` 8 and 9 and every other container 12 to 15, with `docker update --cpuset-cpus <cores> <container>` on the running containers (`--cpus` kept as before; the pinning is lost when a container is recreated). The embedder then sees 4 CPUs instead of 16 and stops fighting the rest of the stack for cores. Same traffic, 50 req/s, 10,120 products, multilingual-e5-small:

| Measurement | Unpinned | Pinned |
| --- | --- | --- |
| Search p95 / p99 | 1.45 s (fails) / 1.85 s | **406 ms (passes)** / 477 ms |
| Median | 10.7 ms | 5.6 ms |
| Failed requests / dropped iterations | none / none | none / none |
| `catalog-service` CPU / event loop busy | 43% of 2 vCPU / 29% | 21% of 2 vCPU / 15% |
| Embedder CPU | 390% of 400% | 198% of 400% |
| Embedder inference p50 / queue wait p50 | 113 ms / 916 ms | **21 ms / 190 ms** |
| Response cache | 50% hits | 53% hits (1,952 hits, 1,712 misses) |
| Query-vector cache | 62 hits, 698 misses | 176 hits, 1,070 misses (14%) |

So 50 requests a second with mostly new three-word queries fit: the embedder used half of its 4 CPUs. The pinned run is the number to quote for this machine. It is one run; the margin to the 500 ms gate is 94 ms.

**1,000 users on one container (1 vCPU, 1 GiB), after all of this.** `catalog-service` limited with `docker update --cpus 1 --memory 1g` and pinned to one core, the embedder (4 cores), Typesense (4 cores) and the rest pinned as above, 10,120 products, `search-users.js` with pages of 20, Zipf-drawn popular queries, 15% one-off queries, one request in five on the second page. One run each, back to back:

| Test | p95 | Median | p99 | Failed | Catalog CPU avg / max | Catalog memory max | Embedder CPU avg |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 users, think 30 s (about 33 req/s), caches cold | **456 ms** (passes) | 8 ms | 593 ms | 0% | 13% / 36% | 263 MiB | 116% of 400% |
| 1,000 users, think 15 s (about 67 req/s), caches warm | **30 ms** (passes) | 5 ms | 45 ms | 0% | 19% / 37% | 283 MiB | 52% of 400% |

The two rows are not like for like. The 15 s run came second and found the caches filled by the first (the 30 s response cache and the 5,000-entry query-vector cache), so its 30 ms is the warm case; the 456 ms of the first run is the cold case and the number to plan on. Before these changes the same 1,000 users failed at think 15 s (p95 1.97 s at 10,120 products). The earlier tables used pages of 60 and uniformly random queries, so they are a harsher traffic mix than this one. Only 10,120 products were measured this time; the 5,000 and 15,000 rows above were not repeated.

**1,000 concurrent users with no think time.** The same container (1 vCPU, 1 GiB), the same pinning and traffic, `search-users.js` with `-e USERS=1000 -e THINK=0`: every user sends the next search the moment the last answer arrives, so the rate is whatever the service can answer. Caches cold, one run.

| Measurement | Result |
| --- | --- |
| Requests answered | 61,913 in the whole run, 387 a second on average (the ramp and ramp-down included) |
| Search p95 / p99 / median | **4.54 s (fails)** / 13.5 s / 1.18 s; slowest 60 s (the k6 timeout) |
| Failed requests | 0.20% (129): timeouts |
| `catalog-service` CPU | **97% of its 1 vCPU on average**, 98% at most; memory 415 MiB |
| Typesense / embedder CPU | 58% of 4 / 193% of 4 |
| Response cache / query-vector cache | 76% hits (37,916 of 50,182) / 32% hits (3,524 of 11,053) |

With 1,000 users in flight and about 390 answers a second, each one waits 1,000 / 390 = 2.6 s on average: a closed loop of 1,000 users cannot do better than the service's throughput allows, and here that is the catalog container's one core. Memory is not the limit. By the same arithmetic a p95 under 500 ms with 1,000 users who never pause needs at least 2,000 answers a second, about five to six times what one core did, so five to six cores of `catalog-service` (Node runs one thread per process: replicas or `node:cluster`). A rerun of the same test on a cleaner machine (Grafana, Loki, Tempo, Mailpit, both web apps and every service but `catalog-service` stopped; k6 pinned to its own cores 10 and 11; the embedder at 2 CPUs instead of 4) did not do better: 296 requests a second, p95 5.38 s, median 1.59 s, 0.33% failed, `catalog-service` at 92% of its core and the embedder at 196% of its 2 CPUs. The other containers were therefore not what held the first run back; the run-to-run spread is about a quarter, and with the embedder at 2 CPUs it is a second limit at this load. That is an estimate from this run, not a measurement. 1,000 users who read for 15 to 30 seconds between searches is the case the previous table measured.

**Where the saturated thread goes.** A CPU profile of the `catalog-service` process for 30 s of that run (inspector, 1 ms sampling; the event loop was busy 94.6% of the window), each sample counted against the closest application or package frame on its stack:

| Share of busy time | Who |
| --- | --- |
| 24% | Node's own HTTP server and sockets (parsing requests, `writev` of responses), with no application frame above |
| 18% | our code (the routes, hybrid search, the Typesense call and its response parsing, about 8% in all) |
| 14% | Express and its router, 1.6% of it computing an ETag for every response |
| 13% | PostgreSQL: drizzle-orm 7.5%, pg 3.4%, pg-protocol 1.7% (two queries for each page that missed the response cache) |
| 12% | OpenTelemetry: HTTP instrumentation 5.4%, context propagation 2.2%, trace SDK 2.1%, metrics SDK 1.8% |
| 6.5% | garbage collection |

No single function stands out: about 40% is the cost of serving an HTTP request at all (Node, Express, ETag), 12% is tracing, 13% is the database lookups behind cache misses, and 18% is ours. One core therefore answers about 2.5 ms of CPU per request, whatever the request is. The levers, from cheapest: more processes (replicas, `node:cluster`); turning off Express's ETag and `x-powered-by`; sampling or narrowing the OpenTelemetry HTTP instrumentation; returning the display fields from Typesense so a miss does not query PostgreSQL (price and stock must still come from PostgreSQL, so this needs a decision); a faster HTTP layer than Express.


A CPU profile of the catalog's Node process for 30 s of the first of these runs (embedder 2 CPUs; the last run's profile shows the same shape, with the event loop busy 29%) (inspector, `Profiler.start`, 1 ms sampling): the event loop was busy 13.3 s of 30.2 s (44%), so the catalog itself had headroom of about two. The busy time: Node internals 26% (mostly socket writes, 6.8% in `writev`), native and anonymous frames 16%, the application's own code 12%, drizzle-orm 8%, garbage collection 4% and 6% for the runtime, OpenTelemetry (trace, HTTP and metrics) about 6%, zod 1.6%. The biggest single functions of ours are the Typesense `search` call and its response parsing (about 5%). Nothing in the catalog stands out. A Node process runs its JavaScript on one thread, so the second vCPU helps only with GC and I/O threads; more throughput from the catalog needs more replicas.

Where to look to raise it, in order of what the measurements support:

- Run the load test with the embedder on its own cores (`cpuset`) or on another host, to get a capacity number that is not the workstation's. On an idle machine, with default settings, the embedder does 97, about 210 and 226 requests a second on 1, 2 and 4 CPUs, so 2 CPUs are enough; size it from that, not from this run.
- Warm the query-vector cache with the popular queries.
- Add catalog replicas to use more than one core, and keep the response cache: it helps as soon as shoppers repeat queries, which this test hardly does.

Two gaps the runs exposed were fixed afterwards: a failed embedding call no longer fails the whole search index sweep, which now retries by itself, and error logs show the cause (see Self-hosted product search embeddings). The others are reported, not fixed:

- Every order refused for stock leaves a `Cancelled` order row, because the order commits before the stock hold.
- Product and opening-balance imports are all or nothing: one bad row returns 400 for the whole payload.

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

The web containers set `Cache-Control` in `apps/nginx-entrypoint.sh`. Files under `/assets/` are named by content
hash, so they are served `public, max-age=31536000, immutable`. Every other path, `index.html` and the single-page
fallback included, is served `no-cache`: the browser keeps a copy but revalidates it on each load, so a deploy is
picked up at once instead of leaving a browser on the old bundle. `curl -sI http://localhost:5302/` shows the header.

Redis stores rate-limit counters and delivery route calculations.

- PostgreSQL remains the authoritative source of truth.
- Delivery cache misses call Vietmap for the address label and OpenRouteService for the route. Cache keys carry a version, so a change in what a cached calculation contains bumps it.
- Cache outages never alter order fees or transition business states.

## Rollback and deployment

- Application container images use immutable content digests (`image@sha256:...`).
- Container startup executes `node dist/migrate.js` before `node dist/main.js`.
- Roll back releases by deploying the previous immutable image digest when migrations are backward-compatible.
