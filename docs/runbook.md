# Pharmacy Central runbook

How to run, operate and troubleshoot Pharmacy Central. The first half is tasks you do by hand, in the order you need them. The second half is reference for one subsystem each.

## Contents

| I want to... | Go to |
| --- | --- |
| Run the project on my machine for the first time | [Local development quickstart](#local-development-quickstart) |
| Choose between day-to-day and as-shipped mode | [Two local modes](#two-local-modes) |
| Load sample data | [Seeds](#seeds-default-a-and-demo-b), [Local sample data](#local-sample-data-development-only) |
| Reset the data before a presentation | [Reset the demo data](#reset-the-demo-data-pnpm-run-demoreset) |
| Run it on AWS, pause it, destroy it | [Run it on AWS](#run-it-on-aws) |
| Fix something that is not working | [Troubleshooting](#troubleshooting) |
| Look at traces, logs and alerts | [Observability](#observability) |
| Understand how events move between services | [Messaging operations](#messaging-operations) |

## Local development quickstart

Infrastructure always runs on Docker Compose. The apps run either on your host or in containers (see [Two local modes](#two-local-modes)). Do this once:

```bash
pnpm install --frozen-lockfile
cp .env.example .env   # then fill in the secrets
pnpm run auth:keygen   # prints ACCESS_TOKEN_PRIVATE_KEY, ACCESS_TOKEN_PUBLIC_JWK and ACCESS_TOKEN_KEY_ID; paste them into .env
pnpm run dev:infra
docker compose ps      # postgres, rabbitmq, redis, mailpit, otel-collector, floci and gateway-dev healthy; floci-init exits 0
pnpm run db:migrate    # creates the databases
```

Then load data (see [Seeds](#seeds-default-a-and-demo-b)): `pnpm run seed:default` creates the admin, `pnpm run seed:demo` the sample dataset.

`API_BASE_URL=http://localhost:8080` in `.env` points browsers and Vite at whichever local gateway is running. Do not change it per service.

### The local AWS emulator (Floci)

Floci stands in for AWS on your machine. It serves S3 for product images and ECR for image push tests.

- **Image and port:** `floci/floci:2.4.0`, pinned by digest, on port 4566. State lives in the `pharmacy-central-floci-data` volume.
- **Bucket:** `floci-init` creates the `product-media` bucket and a policy that allows anonymous `GetObject` on it.
- **Settings in `.env`:** `FLOCI_PORT`, the standard `AWS_*` variables (dummy keys, `us-east-1`), `MEDIA_BUCKET` and `PUBLIC_MEDIA_URL`. S3 uses path-style addressing at `http://localhost:4566`.
- **Never load this `.env` into a process that talks to real AWS.** It holds the emulator's dummy keys. `tools/aws-upload-media.mjs` refuses to run when `AWS_ENDPOINT_URL_S3` is set.
- **Docker socket:** Floci mounts it so it can start the `registry:2` container behind ECR. ECR URIs use the path style (`localhost:4566/<account>/<region>/<repo>`) because Docker 29's containerd image store reaches only `localhost` over plain HTTP.

Try the local ECR with the host AWS CLI, the dummy keys and an explicit `--endpoint-url`, so nothing reaches a real account:

```bash
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
aws ecr create-repository --repository-name pharmacy-central/smoke --endpoint-url http://localhost:4566
aws ecr get-login-password --endpoint-url http://localhost:4566 | docker login --username AWS --password-stdin localhost:4566
docker tag hello-world:latest localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1
docker push localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1
docker pull localhost:4566/000000000000/us-east-1/pharmacy-central/smoke:v1   # after docker rmi of the tag
```

Floci starts a `floci-ecr-registry` container on first use. It lives outside Compose and keeps running after `docker compose down`. Remove it with `docker rm -f floci-ecr-registry`.

### Upload size limits

| Where | Limit |
| --- | --- |
| Local Nginx proxies: catalog and inventory API groups | 25 MB per request |
| Local Nginx proxy: `/api/prescriptions/intake*` | 10 MB |
| Local Nginx proxy: other groups | 1 MB (Nginx default) |
| `catalog-service`: product images (JPEG, PNG, WebP) | 5 MB |
| `catalog-service`: import endpoints | 25 MB |
| `sales-service`: prescription photos | 8 MB |
| Other JSON routes | 1 MB (service default) |

### Two local modes

Infrastructure runs in Docker either way. The modes differ only in where the apps and the gateway run:

| | Dev mode (day-to-day work) | Container mode (check what ships) |
| --- | --- | --- |
| 6 services | Host, `node --watch` | Containers |
| 2 webs | Host, Vite HMR | Containers |
| Gateway on `:8080` | `gateway-dev` container on the host network | `gateway` container |
| Infra | Containers | The same containers |
| Start | `pnpm dev` (starts infra, migrates, runs the apps) | Stop `pnpm dev`, then `pnpm run local:up` (sized like the ECS tasks, migrates) |
| Back to dev mode | | `pnpm run local:down`, then `pnpm dev` |
| Stop everything | `pnpm run dev:down` | `pnpm run dev:down` |

Use dev mode for fast iteration. Run container mode before opening a pull request, and always after changing a Dockerfile, `docker-compose.yml`, environment variables, dependencies or migrations. Every container in `docker compose ps` must be healthy.

#### Dev mode

```bash
pnpm dev   # dev:infra (infra + gateway-dev + migrations), then nx run-many -t dev --all
```

`pnpm dev` starts every service with `node --watch` and both webs with Vite HMR through Nx, which shows one pane per app. Each service's `dev` script runs Node with `--experimental-transform-types`, because Node's strip-only TypeScript mode rejects the parameter properties the services use.

Run a subset by project name (the real names are in `apps/*/package.json`). `gateway-dev` still routes every path to the host, so paths of apps you leave out have no process behind them:

```bash
pnpm nx run-many -t dev -p @pharmacy/sales-service @pharmacy/customer-web
```

**Ports.** Each app's port comes from `<SVC>_PORT` in the root `.env`. The web ports are `CUSTOMER_WEB_PORT` (5301) and `STAFF_WEB_PORT` (5302); Vite sets `strictPort`, so a busy port makes the app fail instead of moving. Nx loads `apps/<svc>-service/.env.dev` for the `dev` target before the root `.env`, so each service binds its own port and gets its own `DATABASE_URL`. Always start apps through Nx. `pnpm --dir apps/<app> dev` skips `.env.dev`, and every service would collide on `PORT=3000`.

**Docker Desktop (Windows and macOS): turn on host networking.** `gateway-dev` uses host networking, which runs inside the Docker VM on these systems.

1. Open Settings, Resources, Network, and turn on **Enable host networking** (Docker Desktop 4.34 or later).
2. Choose Apply & restart.
3. Run `pnpm run dev:infra` again.
4. Check with `curl http://localhost:8080/api/products?limit=1`.

Without it, the container reports healthy but nothing listens on `localhost:8080`, and the Vite proxy logs `http proxy error: /api/... AggregateError [ECONNREFUSED]` for every call. Linux hosts need no setting.

**Why `gateway-dev` uses host networking.** It is the one container that has to call into the host, and host firewalls such as ufw drop container-to-host traffic on the Docker bridge. So it forwards to `127.0.0.1:${<SVC>_PORT}` instead.

#### How services find each other

- **Infrastructure:** services reach Postgres, RabbitMQ and the rest through the published ports (`localhost:5432`, `localhost:5672`, ...), never through a gateway. The gateway only forwards browser `/api/...` calls to the services.
- **Service to service:** services call each other directly with the `*_SERVICE_URL` values in `.env` (`CATALOG_SERVICE_URL`, `IDENTITY_SERVICE_URL`, `INVENTORY_SERVICE_URL`, `SALES_SERVICE_URL`, `PAYMENT_SERVICE_URL`).
- **`/internal` routes** accept only the service secret. The gateway and the ALB do not route them.

Which service needs which URL, and why:

| Service | Needs | Because |
| --- | --- | --- |
| `sales-service` | `IDENTITY_SERVICE_URL` | It looks the account up before filing a prescription with a customer. A missing or wrong value fails the create with `503 identity_unavailable` instead of writing a record against nobody. |
| `payment-service` | `SALES_SERVICE_URL` | It reads the order behind an invoice. |
| `operations-query-service` | `SALES_SERVICE_URL` | It reads the dashboard's prescription figures. |
| `operations-query-service` | `PAYMENT_SERVICE_URL` | Period analytics read paid invoices from `GET /internal/analytics/paid-invoices`. It also reads sales documents and stock health from `/internal/analytics/*` of `sales-service` and `inventory-service`. |
| `inventory-service` | `IDENTITY_SERVICE_URL` | It checks the owner of an action plan against `GET /internal/employees/{id}`. |

Gross profit on the Analytics page shows "—" for sales whose goods have no recorded unit cost. Opening balances carry none, so `seed:demo` receives the shop's stock again through goods receipts with a cost (the demo history step). Your own receipts need a **Giá nhập**. The read behind it is `GET /internal/analytics/dispense-costs` of `inventory-service`.

#### Container mode

```bash
# Stop `pnpm dev` first: the app containers publish the same host ports.
pnpm run local:up     # stops gateway-dev, rebuilds the images, starts everything, migrates, waits until healthy
docker compose ps     # every container must be healthy
pnpm run local:down   # back to dev mode: stops gateway and the app containers, starts gateway-dev again
```

`gateway` and `gateway-dev` share `GATEWAY_PORT` (8080), so only one runs at a time and the two scripts swap them. On a small machine, building all eight images at once can exhaust memory. Build them one at a time first with `docker compose build <name>`.

### Named local URLs

`pnpm run urls:up` starts a [portless](https://github.com/vercel-labs/portless) proxy on `127.0.0.1:80` and registers three names for the fixed ports. It works for `pnpm dev` and for the container stack alike:

| URL | Target |
| --- | --- |
| `http://customer.pharmacy.localhost` | customer-web (`CUSTOMER_WEB_PORT`) |
| `http://staff.pharmacy.localhost` | staff-web (`STAFF_WEB_PORT`) |
| `http://api.pharmacy.localhost` | gateway (`GATEWAY_PORT`) |

- Each name is a separate browser origin with its own `localStorage`, so the customer and staff apps stay signed in side by side.
- `*.localhost` is a secure context in browsers, so `crypto` APIs that need HTTPS work without a certificate.
- The proxy is plain HTTP. For HTTPS run `pnpm exec portless proxy stop`, then `pnpm exec portless proxy start` (it asks to trust a local CA).
- Chrome, Edge, Firefox and `curl` resolve `*.localhost` themselves. Node scripts and Safari may not, so `API_BASE_URL` stays `http://localhost:8080` and `pnpm run seed:demo` is unchanged.
- `pnpm run urls:down` removes the routes and stops the proxy. `pnpm exec portless doctor` checks it.
- Port 80 must be free. If another program holds it, `urls:up` fails with the portless error.

### Open the app

```bash
curl http://localhost:8080/healthz
curl -s http://localhost:8080/api/sites | head -c 200
```

The second command returns the site list with status 200. Catalog reads are public.

- `401 trusted_request_required`: the path needs a bearer access token (see the next section).
- `401 unauthenticated`: the bearer token is missing or expired.

### Call the API by hand

Sign in to get a JWT access token (valid one day), then send it as a bearer token to any service:

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login   -H 'Content-Type: application/json'   -d '{"email":"admin@pharmacycentral.vn","password":"DemoPassword123!"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
curl -s http://localhost:8080/api/orders -H "Authorization: Bearer $TOKEN"
```

- The login response sets no cookie. There is no refresh route: when the token expires, sign in again.
- There is no CSRF token and no sign-out route. A client signs out by discarding the token.
- Identity-service serves the public key set at `/.well-known/jwks.json`. The gateways do not route it, and services read it from `IDENTITY_JWKS_URL`.

### Path routing map

Both local gateways forward paths with identical patterns: `gateway` (container mode) sends them to the app containers, and `gateway-dev` (dev mode) forwards the same paths to the host processes. The rules live once in `deploy/local/gateway/routes.conf`, included by both server blocks.

- `/api/auth*`, `/api/admin*`, `/api/customers*` -> `identity-service:3001`
- `GET /api/products` exactly (the product list) -> `search-service:3009`
- `/api/sites*`, `/api/storage-locations*`, `/api/products*` (every other method and path under it), `/api/suppliers*`, `/api/pricing*`, `/api/stores*`, `/api/availability*` -> `catalog-service:3002`
- `/api/procurement*`, `/api/inventory*` -> `inventory-service:3004`
- `/api/carts*`, `/api/orders*`, `/api/delivery*`, `/api/prescriptions*`, `/api/counter-transactions*`, `/api/sales-targets*` -> `sales-service:3005`
- `/api/payments*` -> `payment-service:3006`
- `/api/operations*`, `/api/dashboard*`, `/api/finance*`, `/api/audit*`, `/api/reports*` -> `operations-query-service:3007`
- `/api/system*` -> `ops-console-service:3010`

Any other path, `/` included, returns a JSON 404. Either gateway strips `/api` before forwarding.

## Daily commands

| Task | Command |
| --- | --- |
| Check status | `docker compose ps` |
| Read logs | `docker compose logs <name>` (add `-f` to follow) |
| Restart one service | `docker compose restart <name>` |
| Rebuild one service image after a change you want to validate as shipped | `docker compose up -d --build <name>` |
| Stop everything, `gateway-dev` included | `pnpm run dev:down` |

Backing tools on your laptop (ports come from `.env`): RabbitMQ management UI at `http://localhost:15672`, Mailpit at `http://localhost:8025`.

## Run it on AWS

Everything is one command, and each command is safe to rerun. Infrastructure is Terraform in `deploy/aws`. The full guide, with what each step does and what it costs, is [deploy/aws/README.md](../deploy/aws/README.md).

| I want to... | Command |
| --- | --- |
| Deploy, or resume after a pause (deploys the latest version tag, builds nothing locally) | `pnpm run cloud:deploy` |
| Build everything from nothing (infrastructure, images, migrations, services, data) | `pnpm run cloud:deploy:fresh` |
| Add the sample data (safe to repeat) | `pnpm run cloud:seed` |
| Wipe the data and load it again | `pnpm run cloud:reset` (add `--yes` when there is no terminal) |
| Stop what costs money by the hour, keep the data | `pnpm run cloud:pause` |
| Delete everything | `pnpm run cloud:destroy` (asks you to type `destroy`) |

**Releasing a version.** Push a version tag and GitHub Actions builds the 12 images and pushes them to ECR with that tag:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

Then deploy that tag (`terraform apply -var image_tag=vX.Y.Z` in `deploy/aws`, or `pnpm run cloud:deploy`).

**What pause keeps and removes.** Pause stops the RDS database, which AWS starts again by itself after 7 days, and deletes the NAT gateway, load balancers, ElastiCache, the ECS services and the Cloudflare DNS records. Data stays in RDS. `cloud:deploy` brings everything back.

**Presenting.** Run `pnpm run cloud:seed` or `cloud:reset` on the day: the sample data's dates are relative to the day it is loaded (see [Reset the demo data](#reset-the-demo-data-pnpm-run-demoreset)).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `localhost:8080` refused or 502 from `/api/...` | Start the gateway for your mode: `pnpm run dev:infra` for dev mode, or `pnpm run local:up` for containers. Only one of the two can hold port 8080 |
| Vite logs `http proxy error: /api/... ECONNREFUSED` while `gateway-dev` is healthy (Docker Desktop) | Host networking is off, so port 8080 never reaches the host. Enable it as described under [Dev mode](#dev-mode), then rerun `pnpm run dev:infra` |
| Gateway 404 on `/api/...` | Check the path against the [routing map](#path-routing-map) |
| `/api/...` returns 401 `trusted_request_required` | The path needs an access token. Sign in and send the `accessToken` as `Authorization: Bearer <token>`; a token lives one day |
| `typesense` exits with code 139 and no log line (Docker Desktop with WSL2) | See below |

**Typesense exits with code 139.** Typesense 30.2 bundles brpc, which reads `/proc/self/io` before `main()`. The WSL2 kernel of Docker Desktop has no task I/O accounting, so the file is missing and the 30.2 server segfaults (upstream [typesense/typesense#2998](https://github.com/typesense/typesense/issues/2998)). Compose pins `typesense/typesense:31.0.rc23` by digest, which starts on that kernel (it only logs `Fail to open /proc/self/io`, which is harmless). Pull it with `docker compose up -d --no-deps --wait typesense`, then check `docker compose ps typesense` and `curl http://localhost:8108/health` (`{"ok":true}`). The AWS task definition (`deploy/aws/data.tf`) pins the same digest, so local and AWS run one version.

## Runtime contract

Use Node.js 24.19.x and pnpm 12.3.4+. Node 25 or later is rejected by the workspace engine policy.

```bash
pnpm install --frozen-lockfile
```

## Identity rate limits and client address

identity-service requires `REDIS_URL`, `AUTH_RATE_LIMIT_MAX_ATTEMPTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS` and `TRUST_PROXY_HOPS`, with no defaults. Startup fails when one is missing or is not a whole number of at least 1.

Other required identity settings:

- `COOKIE_SECURE` must be exactly `true` or `false`, with no default. It adds `Secure` to the OAuth state cookie. Use `false` on the plain-HTTP local URLs and `true` on AWS (`deploy/pharmacycentral.env.example`).
- `ACCESS_TOKEN_PRIVATE_KEY`, `ACCESS_TOKEN_PUBLIC_JWK` and `ACCESS_TOKEN_KEY_ID`, generated by `pnpm run auth:keygen`.
- Every other service except search-service requires `IDENTITY_JWKS_URL`.

The trusted layer of every service drops `x-actor-id` and `x-actor-type` from a request that carries no verified access token or service secret, and logs a `warn` with the request id when it does. Both local gateways also strip those headers from clients. `node --env-file=.env tools/edge-identity-smoke.mjs` checks this against `API_BASE_URL`.

- `TRUST_PROXY_HOPS` is the number of proxies in front of identity-service that append to `X-Forwarded-For`. Locally it is `1`: the nginx gateway overwrites the header with its own `$remote_addr`, so a client cannot supply its own address. Behind AWS the value is unverified. The path is API Gateway HTTP API, then the VPC link, then the internal ALB. Two is the expected value if API Gateway appends the client address and the ALB appends the VPC link address. Confirm that from the `X-Forwarded-For` header of a real request before setting it in `deploy/aws`. A value that is too low keys every client to a proxy address, and a value that is too high lets a client choose its own.
- The Compose stack reaches identity-service through the nginx gateway. Docker usually presents host clients to nginx as the bridge gateway address, which is not verified here, so locally the limit may be one bucket per account rather than per client.
- When Redis is unreachable, `POST /api/auth/login`, `register`, `request-password-reset` and `reset-password`, and `GET /api/auth/verify-email` answer `503 rate_limit_unavailable`. `GET /api/auth/me` reads the profile from Postgres and keeps working for a caller with a valid token.
- To clear a lockout for a support request, find the account's keys with `redis-cli --scan --pattern 'identity:auth-limit:<action>:<digest>:*'`, where `<digest>` is the SHA-256 of the lowercased, trimmed email, then `DEL` them. Keys hold that digest and the client address, never the email itself.

## Database migrations and seeds

Each microservice owns its Drizzle migrations and database schema under `apps/<service>/drizzle/migrations`.

### Run migrations

Migrate all services with one command (it runs each service from its own directory so every database is targeted correctly):

```bash
pnpm run db:migrate
```

In containers, each service runs its compiled `node dist/migrate.js` on startup. Run `pnpm run db:migrate` after every pull.

Notes on specific migrations:

| Migration | What it does | Backfill |
| --- | --- | --- |
| Identity `0003_must_change_password` | Adds `users.must_change_password` (default `false`). | None |
| Inventory `0012_batch_creator_stocktake_counter` | Adds nullable `product_batches.created_by` and `stocktake_lines.counted_by`. A row without a creator is not refused by the separation-of-duties checks (BR-AUTH-009). | None |
| Inventory `0013_action_plans` | Adds the action plan table. | None |
| Inventory `0014_receipt_line_unit_cost` | Adds the nullable purchase cost to goods receipt lines. | None |
| Inventory `0015_disposal_records` | Adds `disposal_records` and `disposal_lines` for the Disposals tab (biên bản tiêu hủy). An approval subtracts stock and writes a `Disposal` ledger entry; a proposal writes neither. | None. Existing negative adjustments stay adjustments, and the new tables start empty. |
| Sales `0014_early_robin_chapel` | Adds nullable `orders.paid_at` and `prescriptions.paid_at`: the first time a paid invoice settled the document, kept after a refund. Payment events fill it from then on. | None. Rows paid before the migration keep no date and read as new customers on Analytics. Dev data is disposable, so reseed. |
| Sales `0015` | Indexes the first-payment lookup (`customer_id`, `paid_at` where paid). | None |
| Sales `0016` | Adds `sales_targets`: one row per site and month, unique on `(site_id, month)`. | None. A month starts with no targets until a Pharmacy Manager sets one. |

### Database roles

Every service connects as its own Postgres role, named after its database (`sales_service`, `payment_service` and so on). The role owns that database and has no `CONNECT` privilege on the others, so a leaked `DATABASE_URL` exposes one service's data, not all of them. `POSTGRES_USER` is the admin account; only role setup and the chaos tooling use it.

- The `postgres-roles` Compose service runs `deploy/local/postgres/roles.sh` after Postgres is healthy and before any backend service starts (`pnpm run dev:infra` includes it).
- The script reads the passwords from `IDENTITY_DB_PASSWORD`, `CATALOG_DB_PASSWORD`, `INVENTORY_DB_PASSWORD`, `SALES_DB_PASSWORD`, `PAYMENT_DB_PASSWORD`, `OPERATIONS_QUERY_DB_PASSWORD` and `CHATBOT_DB_PASSWORD` in `.env`.
- It is safe to run again: it creates missing roles, resets passwords, and moves tables that an older run created as the admin user to the owning role. A stack that already holds data needs only `docker compose up -d postgres-roles`, then the services.
- Migrations run as the owning role (`pnpm run db:migrate` builds each URL from the same passwords), so the tables belong to the role that uses them.
- On AWS, `pnpm run cloud:deploy:fresh` creates the roles and databases (`tools/aws-migrate.mjs`), one secret per service as in `deploy/aws`.

### Seeds: default (A) and demo (B)

There are two seeds. They are separate commands with separate code, and neither repeats the other.

| | A. Default seed | B. Demo and reference dataset |
| --- | --- | --- |
| Command | `pnpm run seed:default` | `pnpm run seed:demo` |
| Code | `apps/identity-service/seed.mjs` | `tools/seed-demo.mjs` and `apps/identity-service/seed-demo.mjs` |
| Creates | Exactly one account: the Platform Admin `admin@pharmacycentral.vn`. Nothing else. | Product images, sites, demo accounts (two managers, pharmacist, warehouse staff, shoppers), storage locations (warehouses), suppliers, products with their units of measure, opening balances, search synonyms, demo activity and 60 days of backdated sales history. |
| Password | `ADMIN_PASSWORD` in `.env` | `DEMO_ACCOUNT_PASSWORD` in `.env` |
| When | Always: on every start and release. It updates the admin by id, so repeating it is safe. | Opt-in, after A. Every step skips what exists, so repeating it is safe. |
| Needs | The migrated identity database | A, the running stack, and the sites created before the accounts (the script keeps that order). |

Business master data in production is imported through the staff import center or the catalog and inventory import APIs, not by seed B.

```bash
# A: the one admin
pnpm run seed:default

# B: the demo and reference dataset (needs the stack or pnpm dev running)
pnpm run seed:demo

# Validate without writing
pnpm --dir apps/identity-service seed -- --dry-run
pnpm --dir apps/identity-service seed:demo -- --dry-run
```

- Seed A resets the admin's roles to Platform Admin on every run and touches no other account.
- Seed B creates one account per staff role (two Pharmacy Managers, Pharmacist, Warehouse Staff) and the shoppers. Each staff account holds only its role, and every run resets roles and site access.
- Site access is looked up by code from the imported sites: all four sites for the managers, the three that hold stock for warehouse staff, `SITE-RTL` for the pharmacist. So `seed:demo` creates the sites from `data/import-samples/sites.csv` first and stops if a site is missing.
- The account list is in `docs/user-guide.md`.

On AWS the same seed runs with `pnpm run cloud:seed` (see [Run it on AWS](#run-it-on-aws)).

### Import staff-managed data

Staff import CSV files from the Data import screen in `staff-web` (`http://127.0.0.1:5302/imports` locally). The matching API endpoints are:

| Dataset | Endpoint |
| --- | --- |
| Sites, storage locations, suppliers, products, units, prices | `POST /api/products/imports` |
| Opening stock balances | `POST /api/inventory/imports/opening-balances` |

How it works:

- The screen generates one CSV template per dataset in the browser, from the same column list the parser uses. Templates hold headers only: no sample records ship with the web app, and nothing under an app `public/` directory is a data store.
- The browser converts the CSV into the JSON payload that the service validates. The HTTP contract stays JSON.
- Imports are idempotent on natural keys (`code`, `sku`, `batchNumber`).
- An opening balance row is accepted only while the batch and storage location have no stock balance or ledger history. Reimporting the same quantity is a no-op. Changing an existing balance requires a stock adjustment so the ledger keeps an audit trail.

**Import order matters**, because rows are resolved by natural key:

1. Images (uploaded by `seed:demo`, since `products.csv` carries Floci S3 URLs whose object keys are content hashes)
2. Sites
3. Storage locations and suppliers
4. Products
5. Opening balances

**Where the files live.** Source files stay outside the application image. The committed fixture set is in `data/`: the sample CSVs in `data/import-samples/` and the coursework images in `data/product-images/images/`, so a fresh checkout can exercise both flows. Any other file comes from the operator's machine (`~/Downloads/...`); the API never reads a server-side path. Original downloads, source-verification records (`provenance/`) and research dumps (`research/`) stay local.

**Where the data ends up.** Catalog data in `catalog-service`, stock in `inventory-service`, images in Floci S3.

#### Local sample data (development only)

A fresh local database has no accounts and no master data. Migrations create empty tables, and everything else exists only after an import. These steps fill it all:

```bash
pnpm run dev:infra      # infra + gateway-dev (host networking on Docker Desktop) + migrations
pnpm run seed:default   # A: the one admin (needs only the identity database)
pnpm dev                # the services must be running: seed B goes through the API
pnpm run seed:demo      # B: the demo dataset, in another terminal
```

`seed:demo` runs `tools/seed-demo.mjs`, which does these steps in order:

1. **Sign in** as the default admin (`admin@pharmacycentral.vn`, password `ADMIN_PASSWORD`). It stops with a pointer to `pnpm run seed:default` if that fails.
2. **Upload the product images** to Floci S3.
3. **Create the sites** one at a time as the admin (`POST /api/sites`, because the site import is a Pharmacy Manager's).
4. **Create the demo accounts** (`apps/identity-service/seed-demo.mjs`), so the managers, pharmacist and warehouse accounts get their site access in one pass.
5. **Import the sample CSVs** from `data/import-samples/` through the same endpoints as the Data import screen, each as the role that owns it: a Pharmacy Manager imports the storage locations, the suppliers, and the products with their prices; Warehouse Staff import the opening balances. It reuses the screen's CSV mapping from `apps/staff-web/src/import-datasets.ts`, so the two cannot drift.
6. **Create and approve the six search synonym groups**, such as `tiêu chảy, đi ngoài, đi lỏng`. The first Pharmacy Manager proposes them and the pharmacist approves them, so live search uses them from the start. One more group (`ho khan, ho không đờm, ho rát cổ`) is left waiting for approval. Production starts with no synonym groups; staff add them in staff-web under Search synonyms.
7. **Add demo activity** through the same APIs, so every list screen has rows in every state: three transfers (waiting, in transit, received), three stock adjustments (pending, approved, rejected), three purchase orders (waiting, approved, cancelled) and fifteen orders at `SITE-RTL`.
8. **Add the sales history** (`tools/seed-demo-history.mjs`, below).

Notes on the steps:

- **The orders.** The demo shopper `khachhang@pharmacycentral.vn` owns nine of them, one in every state the customer site draws: waiting for payment, confirmed, preparing, ready, out for delivery, completed (pickup and delivery), cancelled, and refunded. Each of the six sample shoppers holds one state, so signing in as one of them shows the order page featuring only that state. Each order is placed the way checkout places it, with its payment invoice under the same id. A QR order is paid by a webhook signed with `SEPAY_WEBHOOK_SECRET`, a cash order by the counter, and the refunded one goes back through the refund endpoint.
- **Running it again is safe.** Each record has a fixed number and is skipped when it exists, and the opening balances are skipped once stock has moved. The orders are skipped while any exist, so clear the sales and payment data before reseeding them.
- **Database access.** Each seed connection uses its own database role and `<SERVICE>_DB_PASSWORD`, as the services do.
- **Search index.** Stock rows wait for the product search index to catch up, which takes a few seconds after a product import.

**The sales history step.** `tools/seed-demo-history.mjs` makes the dataset look like a shop that has traded for two months.

- It receives the shop's stock through five approved purchase orders (`PO-HIST-001` to `005`) and their goods receipts (`GR-HIST-001` to `005`), with a unit cost on every line, so gross profit has real figures.
- It places about 200 sales over the last 60 days, backdated one by one: counter prescriptions paid in cash, and online orders paid by SePay QR or cash on delivery, pickup or delivery, with a few cancelled and refunded. The trend charts, channel split, top products, finance entries and audit log all show those days.
- It leaves, on purpose: batches of six products that expire in 6, 12, 20, 27 and 45 days; one batch already 8 days past expiry (`GR-HIST-EXP`); six dead-stock products with no movement for 130 days; seven prescription-only medicines and one supply that have stock but no price; five products that end the history thin against their recent sales (replenishment suggestions with a shortfall); two more replenishment requests; and carts for two shoppers.
- No API sets the creation time of an order or a payment, so the backdating is SQL through `docker compose exec postgres psql` (it needs Docker Compose and `POSTGRES_USER` in `.env`).
- The step runs once: if goods receipt `GR-HIST-001` exists it adds nothing.
- A last step in the same file fills the warehouse site (`SITE-WH`, the screens of the warehouse account): three goods receipts with a cost, one purchase order waiting for approval, replenishment requests in each state, two returns, a posted and an open stocktake, and adjustments in each state. Warehouse Staff creates them and a Pharmacy Manager decides, because nobody approves their own record. It runs once, marked by goods receipt `GR-WH-001`.
- To run the history again, use `pnpm run demo:reset` (below).

**Action plans.** `inventory-service` creates the automatic action plans when it starts and every 15 minutes. Restart it once after seeding (`docker compose restart inventory-service`) to get the plans for the expiring batches and the shortfalls without waiting.

**This is a development tool, kept apart from production on purpose.**

- It only runs from the `seed:demo` script and is not part of any image or deployment. It never creates or changes the admin: that is seed A.
- It refuses to run with `NODE_ENV=production`. It accepts only an `API_BASE_URL` of `localhost`, `127.0.0.1` or `[::1]`, or the cloud target set by `pnpm run cloud:seed`.
- The sample files are fabricated coursework data. Production data is imported by an operator on the staff-web Data import screen with a real account, from the operator's own files.

**Without the script**, run `pnpm run seed:default`, then upload the same files by hand at `http://127.0.0.1:5302/imports` as a Pharmacy Manager, in this order: `sites.csv`, `storage-locations.csv`, `suppliers.csv`, `products.csv`. Right after `sites.csv`, run `pnpm --dir apps/identity-service seed:demo` to create the demo accounts with their site access. Then sign in as Warehouse Staff and import `opening-balances.csv`.

### Reset the demo data (`pnpm run demo:reset`)

Every date in the demo dataset is relative to the day it is seeded. The opening-balance expiry dates in `data/import-samples/opening-balances.csv` are written against 2026-10-29 and `seed:demo` moves each one by the days since. The history, receipts and expiry countdowns count back or forward from the seed time. The data then ages with the clock (an expiry countdown drops by a day each day, the newest sale gets older), so **reseed on the day you present**.

`pnpm run demo:reset` (`tools/demo-reset.mjs`) does it in one command, in container mode. It takes about three minutes. It:

1. stops the services,
2. drops and recreates the seven service databases,
3. removes the Typesense volume,
4. runs `db:migrate`,
5. starts the services (`--no-deps`, so an unhealthy Typesense does not block them),
6. runs `seed:default` and `seed:demo`,
7. restarts `inventory-service` so the automatic action plans are raised against the fresh stock, and prints how many exist.

It is destructive. It refuses `NODE_ENV=production` and any `API_BASE_URL` that is not a loopback host, and it needs the stack from `pnpm run local:up` (or at least `postgres`, `rabbitmq`, `redis`, `floci` and the gateway) to be up.

`pnpm run seed:demo` alone is idempotent but never refreshes the dates of data it already created. It warns when the history is a day old. For AWS use `pnpm run cloud:reset`. The presenter's script is [Demo walkthrough](demo-walkthrough.md).

### Product images

The committed images are one file per product in `data/product-images/images/`, named `<SKU>.<ext>` (PNG, JPEG or WebP).

- `pnpm run seed:demo` uploads them to the local Floci S3 bucket under the content-hash key `product-images/<SKU>/<sha256>.<ext>`. The URL is therefore the same for everyone and matches the `imageUrl` column of `data/import-samples/products.csv`.
- The upload validates every file before sending any, and warns about a product whose `imageUrl` was not uploaded.
- To add or replace an image, drop `<SKU>.<ext>` into the folder, rerun the command, and copy the new URL into `products.csv`.
- Original downloads and source-verification records stay local in `data/product-images/originals/` and `provenance/`.
- `data/` is excluded from container builds via `.dockerignore`.

### Try prescription intake

Prescription intake needs these migrations, so run `pnpm run db:migrate` after pulling: catalog `0005_text_search_extensions` (`pg_trgm` and `unaccent`), catalog `0006_folded_trigram_indexes` (the `catalog_fold` function and its trigram indexes), and sales-service `0005_salty_trish_tilby` (the `prescription_consultations` table, for consultation requests). Import `products.csv` first, because suggestions come from the catalog.

1. Sign in to staff-web as `admin@pharmacycentral.vn`, open **AI integrations**, and save the provider, model, base URL and API key under **Prescription photo reading**. Or set all four `AI_PRESCRIPTION_READER_*` variables in `.env` (see `.env.example`), which are all or none. Until settings are saved, or the four variables are set, the photo path answers `503` and only QR intake works.
2. Sign in as the customer account and open `http://localhost:5301/gui-don-thuoc`.
3. Upload a page from `data/prescription-samples/`. `<slug>.png` carries a QR (read in the browser, no provider call). `<slug>-no-qr.png` is the same page without it and exercises Gemini. `<slug>.json` is the ground truth to compare against.
4. The sample has one prescription, `tang-huyet-ap-dai-thao-duong`, with six lines. Five match catalog products: Amlodipin 5mg, Savi Losartan 50mg, Diamicron MR 30mg, Atorvastatin 20mg and Plavix 75mg. These are prescription-only with no price, so the page shows "Liên hệ báo giá" and they cannot be added to the cart.
5. Aspirin 81mg has no catalog match, so the page offers "Nhờ dược sĩ tìm giúp" for the whole prescription. The request is filed through `POST /prescriptions/consultations` with that line flagged.

`pnpm run prescriptions:samples` generates that page. Its medicines all come from `products.csv`, and like other generated output it stays local and is not committed.

### Chatbot token usage

The chatbot service logs one line for each question the model answers, with the message `chat turn usage`. The line has five counts: input tokens, cached input tokens, output tokens, thought tokens, and `modelCalls`.

- `modelCalls` is the number of model calls made for that question, at most three. A question that needs no product lookup has one.
- A high thought count means the model spent many tokens reasoning at its thinking level.
- A cached count above zero means implicit caching hit. Caching cannot start until the stable prompt prefix reaches the model's minimum size, so zero is expected while the prompt stays below that minimum.
- The line holds counts only, never the question, the reply, or any customer or product data.

### Intent gate

The intent gate runs one TypeSafe Jev request before each question reaches the chat model. Its settings use the purpose `INTENT_GATE`, the environment group `AI_INTENT_GATE_*`, and the staff-web card **Question screening**. With no settings the gate is off.

- Each decision logs `intent gate decision` with the fields `decision`, `reason`, `intent`, `intentConfidence`, `emergency` and `injection`.
- A Jev failure after the retries answers `503 assistant_unavailable`. The service logs `chat dependency failed` with the error `IntentGateError`.
- The timeout and retry constants are `ATTEMPT_TIMEOUT_MS = 4000`, `MAX_ATTEMPTS = 3`, `BACKOFF_BASE_MS = 200` and `BACKOFF_CAP_MS = 2000` in `apps/chatbot-service/src/infrastructure/jev-intent-classifier.ts`.
- The thresholds are `EMERGENCY_THRESHOLD = 0.6`, `INJECTION_THRESHOLD = 0.7` and `INTENT_CONFIDENCE_THRESHOLD = 0.6` in `apps/chatbot-service/src/modules/chat/intent-policy.ts`. They are untuned starting values.

### Demo credentials

Credentials for local development and the sample dataset. The admin comes from the default seed (A), and its password is the `ADMIN_PASSWORD` value from `.env`. Every other account comes from the demo seed (B), and its password is the `DEMO_ACCOUNT_PASSWORD` value.

| Role | Email | Site access |
| --- | --- | --- |
| Platform Admin (seed A) | `admin@pharmacycentral.vn` | All sites |
| Pharmacy Manager | `manager@pharmacycentral.vn` | `SITE-HQ`, `SITE-WH`, `SITE-HUB`, `SITE-RTL` |
| Pharmacy Manager (second, for approvals) | `manager2@pharmacycentral.vn` | `SITE-HQ`, `SITE-WH`, `SITE-HUB`, `SITE-RTL` |
| Pharmacist | `pharmacist@pharmacycentral.vn` | `SITE-RTL` |
| Warehouse Staff | `warehouse@pharmacycentral.vn` | `SITE-WH`, `SITE-HUB`, `SITE-RTL` |
| Customer | `khachhang@pharmacycentral.vn` | Customer portal |
| Customer (sample shoppers) | `nguyen.lan@example.com`, `tran.minh.khoa@example.com`, `le.thanh.huong@example.com`, `pham.quoc.viet@example.com`, `vo.ngoc.mai@example.com`, `dang.hoang.nam@example.com` | Customer portal |

## Staff-web interaction motion

Staff-web gives every action physical weight through one opt-in stylesheet, `packages/ui/src/weight.css` (exported as `@pharmacy/ui/weight.css`). `apps/staff-web/src/index.css` imports it after `theme.css`; customer-web does not, so the shared components stay instant there. The decision and its reasoning are in [ADR 0020](adr/0020-interactions-have-physical-weight.md).

- Components carry markers, not timing: `data-weight` (`press`, `item`, `field`, `row`, `panel`, `backdrop`, `dialog`, `sheet`, `toast`, `thumb`) and `data-state` (`open`/`closed`). Adjust the feel by editing the tokens at the top of `weight.css` (`--weight-press`, `--weight-release`, `--weight-sink`, `--weight-scale-down`, `--weight-spring`), never by adding a duration at a call site.
- A panel that leaves gets an exit animation: `usePresence(open)` keeps it mounted until the animation ends and unmounts it at once when no animation exists. It also goes inert and stops taking clicks while closing.
- Close through `open`, not by mounting conditionally. For a drawer that opens for one row, use the retained pattern:

  ```tsx
  const planDrawer = useRetainedTarget(planDraft);
  {planDrawer ? (
    <CreatePlanDrawer key={planDrawer.key} open={planDraft !== undefined} draft={planDrawer.target} onClose={...} />
  ) : null}
  ```

  `key` changes on every opening, so the drawer starts clean; the drawer takes `open` and gates its unsaved-changes guard and save shortcut on it (`FormDrawer` does both).
- Every write goes through `writeJson`, which answers no sooner than `MINIMUM_WRITE_MS` (320ms) so the control that sent it holds its working state long enough to be seen. A slower write is unaffected; a read is never delayed.
- Movement is skipped under `prefers-reduced-motion`; colour and opacity still change.
- Driving the UI in a test: wait for the closing panel to leave the DOM, not only for `data-state` to read `closed`. In headless Chromium a page with no animation frames can stall CSS animations, so drive it with a `requestAnimationFrame` loop when a script must see the exit finish.

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

- AWS API Gateway HTTP API exposes `/api` routes. The integration forwards `Authorization` untouched and overwrites only the path and `x-request-id`.
- Authentication is one ES256 JWT access token that lives one day (ADR 0005, ADR 0021). There is no refresh token, session cookie or sessions table. Browsers keep the token in `localStorage`, sign-out is client-side, and revocation is by expiry, at most one day.
- Every service verifies `Authorization: Bearer <access token>` against the JWKS of `identity-service` (`IDENTITY_JWKS_URL`), refuses an employee role that its own rule table does not allow (ADR 0017), and sets `x-actor-id`, `x-actor-type`, `x-actor-roles` and the site ids from the token, discarding any client-supplied value of those headers (ADR 0006).
- No route authenticates with a cookie, so there is no CSRF token. The external SePay webhook route carries no token and uses HMAC payload verification.

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

The local stack collects traces, metrics and logs. `pnpm run dev:infra` starts the `otel-collector`, `tempo`, `prometheus`, `loki` and `grafana` containers together with the rest of the infrastructure.

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

staff-web has a System page in the Administration workspace. Only a Platform Admin sees it. It talks to `ops-console-service` (port 3010), which has no database and writes nothing. The page has four tabs, held in the URL as `?tab=`: Services, Messaging, API routes and Dashboards. The header (status line, refresh) stays on every tab; the window picker shows on Services only.

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
- Access is checked twice: the service (verified access token, role `Platform Admin`, employee), and the staff-web menu.
- Required environment (no defaults): `PORT`, `IDENTITY_JWKS_URL`, the eight `*_SERVICE_URL`, `PROMETHEUS_URL`, `RABBITMQ_MANAGEMENT_URL`, `RABBITMQ_MANAGEMENT_USER`, `RABBITMQ_MANAGEMENT_PASSWORD`, `TYPESENSE_URL`, `TYPESENSE_API_KEY`, `GRAFANA_PUBLIC_URL`.
- The page is read only: no replay of dead letters, no reindex.
- The service catalog (`GET /api/system/catalog`) and the route table (`GET /api/system/routes`) are constants of the service, in `src/modules/system/service-manifest.ts`, `probed-services.ts` and `route-table.ts`. The service reads nothing from `deploy/` at runtime. When a gateway path, a platform-admin path, an ALB rule or a service dependency changes, change the table or the manifest too. `route-table.test.ts` fails when `deploy/local/gateway/routes.conf`, or `deploy/aws/main.tf` disagree with the table. `service-manifest.test.ts` checks that every probed service has an entry, that every `dependsOn` names a known service, that every consumed event is published, and that every runbook anchor is a heading of this file. The dependencies and events come from the code (`*_SERVICE_URL` use, `fetch` calls, outbox writes, queue bindings), so update them when those change.
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

Semantic product search needs a text-embedding model. The default is the `embedder` service of Compose: HuggingFace text-embeddings-inference on CPU, model `intfloat/multilingual-e5-small` (384 dimensions), ONNX weights. `pnpm run dev:infra` and `pnpm run local:up` start it with the rest of the infrastructure, so search needs no quota and no key from a provider. The first start downloads the model into a volume (about 2 minutes here), and until it is healthy search matches keywords only.

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

Load tests run with k6, chaos tests with a Node runner against the deployed stack (`chaos:aws`). Both are workstation tools, never part of a container image. Run them against the **container stack** (`pnpm run local:up`): under `pnpm dev`, `node --watch` restarts services and leaves stale keepalive connections in the gateway, which shows up as 60 s stalls that are not application problems.

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

Chaos against the deployed stack is `pnpm run chaos:aws <scenario|all> [--duration 240]` (`tools/chaos/aws/runner.mjs`). It injects each fault through the ECS API, holds a steady browse load of 20 journeys a second, and reads every invariant through the public API, because RDS and Typesense are private. Checkout, payment, import and the chatbot are out of scope. It calls the AWS CLI with the `pharmacy` profile (`tools/chaos/lib/ecs.mjs`: region `us-east-1`, cluster `pharmacy-central-staging`; the dummy `AWS_*` keys of `.env` are cleared), so run `aws sso login` or configure that profile first. `.env` also needs `CHAOS_BASE_URL` (the staff site), `DEMO_ACCOUNT_PASSWORD` and `GRAFANA_PORT`.

| Scenario | Fault |
| --- | --- |
| `typesense-outage` | Typesense service scaled to 0 for 45 s: search falls back to SQL, reads keep working, search recovers. |
| `catalog-kill` | catalog-service tasks stopped under load. |
| `identity-kill` | identity-service tasks stopped under load. |

To point k6 at the deployed stack, set `LOAD_TARGET_URL` in `.env` to the public URL of the stack (the same value as `CHAOS_BASE_URL`; k6 only makes HTTP calls, so it needs no AWS CLI); the scripts use the demo accounts, so seed the stack first. Size the run against the Fargate vCPU quota and the task sizes in `deploy/aws/variables.tf`.

### Capacity on an ECS-sized stack

`pnpm run local:up` layers `docker-compose.aws-like.yml` over the container stack and sizes it like `deploy/aws` as `terraform.tfvars` runs it: one container per service (`desired_count = 1`, autoscaling off). Backend services get 0.5 vCPU and 2 GiB (`task_cpu` 512, `task_memory` 2048), `customer-web` and `staff-web` 0.25 vCPU and 512 MiB, RabbitMQ and Typesense 0.25 vCPU and 512 MiB (their Fargate tasks in `data.tf`), and the embedder 2 vCPU and 4 GiB. PostgreSQL (RDS `db.t4g.micro`) gets 2 CPUs and 1 GiB and Redis (ElastiCache `cache.t4g.micro`) 2 CPUs and 512 MiB. Change the compose file when `variables.tf` or `data.tf` changes.

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

## Security checks in CI

`.github/workflows/ci.yml` fails a pull request when `pnpm audit --prod` finds a high or critical advisory, or when
gitleaks finds a secret anywhere in the history. A failed audit is fixed by updating the package, or by adding a
version floor under `overrides` in `pnpm-workspace.yaml` when the package is only a transitive dependency.
`.github/workflows/codeql.yml` reports code findings under the repository's Security tab and does not block merges.
`.github/dependabot.yml` opens the weekly update pull requests.

## Web edge hardening

The same script, `apps/nginx-entrypoint.sh`, adds the browser security headers and a per-client rate limit.

- **Headers.** Every response carries `Content-Security-Policy` (scripts from the same origin only; images from any
  https origin; `https://*.vietmap.vn` and `blob:` workers for the map; `frame-ancestors 'none'`),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy` (camera and
  geolocation for the same origin only). `Strict-Transport-Security` is sent only when `X-Forwarded-Proto` is `https`,
  so the ALB's https requests get it and plain http does not. If a new page loads a script, font or API from another
  host, the browser console reports a CSP violation: add the host to the policy in the script.
- **Rate limit.** `/api/` allows `API_RATE_LIMIT_RPS` requests per second per client (default 30) with a burst of
  `API_RATE_LIMIT_BURST` (default 60); the rest get `429` with `Retry-After: 1`. Static files are not limited. The client
  address is the last untrusted entry of `X-Forwarded-For` behind the ALB (the VPC range `10.20.0.0/16` is trusted). A
  store whose staff share one public address share one bucket, so raise the two values before lowering them.

Redis stores rate-limit counters and delivery route calculations.

- PostgreSQL remains the authoritative source of truth.
- Delivery cache misses call Vietmap for the address label and OpenRouteService for the route. Cache keys carry a version, so a change in what a cached calculation contains bumps it.
- Cache outages never alter order fees or transition business states.

## Rollback and deployment

- Application container images use immutable content digests (`image@sha256:...`).
- Container startup executes `node dist/migrate.js` before `node dist/main.js`.
- Roll back releases by deploying the previous immutable image digest when migrations are backward-compatible.
