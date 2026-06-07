# Pharmacy Central

Pharmacy Central is an internal pharmacy operations platform for managing pharmacy sites, product data, purchasing, receiving, batch quality review, inventory operations, counter sales, payment capture, reporting, finance reconciliation, audit trails, and user access.

The application is a single internal web app backed by an ASP.NET Core API, PostgreSQL, Entity Framework Core migrations, and a React/Vite frontend. Aspire is used for local orchestration during development.

## What the app supports

- Authentication, CSRF protection, role-based access control, and site-scoped data access.
- User and role management for Platform Admins.
- Site and storage location management.
- Product catalog, supplier catalog, pricing, and active price lookup.
- Purchase orders and receiving.
- Batch quality release/reject workflow.
- Inventory visibility, inventory history, stocktake, and approved adjustments.
- Warehouse transfers, returns/removals, recalls, and batch blocking.
- Counter-sale workflow for Pharmacists, including stock reservation, dispensing, payment invoice creation, QR payment instructions, and printable invoice popup.
- Dashboard, reporting, finance reconciliation, and audit log views.

## Roles

| Role | Main responsibility |
| --- | --- |
| Platform Admin | System administration, users, roles, site access, audit, and system oversight |
| Pharmacy Manager | Master data, pricing, procurement, reporting, finance, and recalls |
| Pharmacist | Counter-sale workflow, payment, and dispensing |
| Warehouse Staff | Receiving, quality review, transfers, returns/removals, inventory, stocktake, and adjustments |

Pharmacists do not access the general Inventory, Returns, or Transfers workspaces. They only see sale availability inside the counter-sale workflow for their assigned selling source.

## Repository layout

```text
src/
  AppHost/          Aspire orchestration
  Web.Api/          ASP.NET Core API and endpoint adapters
  Application/      Use cases organized by feature and workflow
  Domain/           Domain entities and business statuses
  Infrastructure/   EF Core, persistence, identity, authorization, provider adapters
  Frontend/         React + Vite single-page app

tests/
  PharmacyCentral.UnitTests/  xUnit backend tests

docs/
  Architecture.md   System architecture and module boundaries
  UserGuide.md      User-facing workflow guide
  ApiGuide.md       API, auth, CSRF, and endpoint guide
  Runbooks.md       Local operations and verification guide
```

## Prerequisites

Install the .NET SDK:

```bash
winget install Microsoft.DotNet.SDK.10
```

Install the .NET Aspire CLI:

```bash
dotnet tool install -g Aspire.Cli
```

Install Node.js LTS:

```bash
winget install OpenJS.NodeJS.LTS
```

Install pnpm if it is not already available:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

Trust the local development certificate:

```bash
dotnet dev-certs https --trust
```

Restart the terminal after installing tools so `dotnet`, `aspire`, `node`, and `pnpm` are available on PATH.

## Local development

From the repository root:

```bash
dotnet restore
```

Install frontend dependencies:

```bash
cd src/Frontend
pnpm install
cd ../..
```

Start the Aspire AppHost:

```bash
aspire run
```

Aspire starts the API, PostgreSQL, and frontend together. Open the frontend endpoint from the Aspire dashboard. In the current AppHost setup, the frontend is usually served at:

```text
http://app.pharmacy.dev.localhost:5200/
```

Use the AppHost URL above for browser checks instead of `localhost:5200`.

## Demo and seed configuration

Seed behavior is controlled by environment variables:

```text
PHARMACY_SEED_ADMIN_USER=true
PHARMACY_SEED_DEMO_USERS=false
PHARMACY_SEED_BUSINESS_DATA=false
```

Meaning:

- `PHARMACY_SEED_ADMIN_USER`: creates the development Platform Admin account when the database is empty.
- `PHARMACY_SEED_DEMO_USERS`: creates role-specific demo users when needed for demos.
- `PHARMACY_SEED_BUSINESS_DATA`: creates demo business data such as products, batches, stock, documents, and history.

To test the first-admin setup screen, use a disposable database and set:

```text
PHARMACY_SEED_ADMIN_USER=false
```

## Common verification commands

Backend build:

```bash
dotnet build --artifacts-path .tmp/readme/dotnet
```

Backend tests:

```bash
dotnet test PharmacyCentral.sln --artifacts-path .tmp/readme/tests
```

Frontend checks:

```bash
cd src/Frontend
pnpm lint
pnpm exec tsc --noEmit
pnpm exec vite build --outDir ../../.tmp/readme/frontend
```

Use `.tmp/<task>/...` output folders for builds during active Aspire sessions so local build artifacts do not interfere with the running app.

## Database and migrations

Schema is managed by EF Core migrations. The application applies migrations on startup.

Add a migration after domain/entity schema changes:

```bash
dotnet ef migrations add <MigrationName> --project src/Infrastructure --startup-project src/Web.Api
```

Do not add raw `CREATE TABLE` SQL to the seeder. The seeder inserts data only.

To reset the local Aspire PostgreSQL database, use the reset script documented in `docs/Runbooks.md`.

## Payment and local webhook development

The payment workflow is provider-neutral. SePay is the first provider adapter for VietQR-style payment confirmation.

Local SePay Test mode webhook delivery requires the API to be reachable from the public internet. Use the project-local Cloudflare Tunnel configuration under `.cloudflared/` when testing webhooks. Do not edit the global Cloudflare tunnel configuration for other projects.

Payment config values live in environment variables, including provider, bank account information, webhook secret, QR settings, and feature toggle. See `deploy/pharmacycentral.env.example` and `docs/Runbooks.md`.

## Local deployment package

The repository includes a local production-like package for validation and handoff only. It does not push images or deploy to any external environment.

Validate the compose configuration:

```bash
docker compose --env-file deploy/pharmacycentral.env.example config
```

Build the local package:

```bash
docker compose --env-file deploy/pharmacycentral.env.example build
```

Run it locally only when needed:

```bash
docker compose --env-file deploy/pharmacycentral.env.example up
```

Check health:

```bash
curl http://localhost:8080/health
```

## Documentation

- [Architecture](docs/Architecture.md)
- [User Guide](docs/UserGuide.md)
- [API Guide](docs/ApiGuide.md)
- [Runbooks](docs/Runbooks.md)

Keep code and docs synchronized when changing roles, policies, workflows, routes, endpoints, or configuration.
