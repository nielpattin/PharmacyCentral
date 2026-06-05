# Pharmacy Central Runbooks

These runbooks cover local development and local package validation. They do not describe a real cloud deployment.

## Start development environment

From the repository root:

```bash
aspire run
```

Wait until the API and frontend resources are healthy in Aspire.

Typical local endpoints:

```text
Frontend: http://localhost:5200
API:      https://localhost:7528
Health:   https://localhost:7528/health
```

Use the actual Aspire resource URLs if ports differ.

## Stop development environment

In the visible Aspire terminal, stop the running process with Ctrl+C. If Windows asks:

```text
Terminate batch job (Y/N)?
```

answer:

```text
Y
```

## Backend build check

When Aspire is running, keep build output isolated:

```bash
dotnet build PharmacyCentral.sln --artifacts-path .tmp/runbook/dotnet-artifacts
```

## Frontend build check

```bash
cd src/Frontend
pnpm lint
npx tsc --noEmit
npx vite build --outDir ../../.tmp/runbook/vite
```

## Product verification

With Aspire running and the API healthy:

```bash
node tests/product-api-verify.mjs
```

Optional environment variables:

```bash
PHARMACY_API_BASE_URL=https://localhost:7528/api \
PHARMACY_ADMIN_EMAIL=admin@pharmacy.local \
PHARMACY_ADMIN_PASSWORD='Admin@123!' \
node tests/product-api-verify.mjs
```

## Local package build

This validates the container package only. It does not push or deploy anything.

```bash
docker compose --env-file deploy/pharmacycentral.env.example build
```

## Local package run

For local validation only:

```bash
docker compose --env-file deploy/pharmacycentral.env.example up
```

Health check:

```bash
curl http://localhost:8080/health
```

Stop local package:

```bash
docker compose --env-file deploy/pharmacycentral.env.example down
```

Remove local package data volume if needed:

```bash
docker compose --env-file deploy/pharmacycentral.env.example down --volumes
```

## Database migration behavior

`Web.Api` applies EF Core migrations on startup. When a new migration is generated while Aspire is already running, rebuild and restart the API before product verification so the running API has the new schema-aware binaries.

## Development database backup

For the Aspire PostgreSQL container, find the running container:

```bash
docker ps --filter name=postgres-pharmacycentral
```

Create a local backup:

```bash
docker exec postgres-pharmacycentral pg_dump \
  -U postgres \
  -d pharmacycentraldev \
  --format=custom \
  --file=/tmp/pharmacycentraldev.backup

docker cp postgres-pharmacycentral:/tmp/pharmacycentraldev.backup .tmp/pharmacycentraldev.backup
```

## Development database restore

Restore only to a disposable development database/container. Stop the app first.

```bash
docker cp .tmp/pharmacycentraldev.backup postgres-pharmacycentral:/tmp/pharmacycentraldev.backup

docker exec postgres-pharmacycentral pg_restore \
  -U postgres \
  -d pharmacycentraldev \
  --clean \
  --if-exists \
  /tmp/pharmacycentraldev.backup
```

Then restart the API/app and run smoke checks.

## Smoke checks after restart

1. `/health` returns success.
2. Login succeeds.
3. `/api/auth/me` returns the expected user and roles.
4. Dashboard loads.
5. Inventory balances load.
6. Product verification script passes when a full workflow check is needed.

## Rollback notes

For local development:

1. Stop the app.
2. Revert the Git commit or checkout the previous commit.
3. Restore a compatible database backup if schema/data changed.
4. Restart the app.
5. Run smoke checks.

For real environments, use environment-specific deployment and backup tooling. Do not rely on this local runbook as a full production rollback plan.

## Common issues

### CSRF fails over HTTP

Use HTTPS for API calls that need CSRF in development. Fetch CSRF before login and again after login.

### File lock during build

If building into normal project output while the API is running, files may be locked. Prefer `--artifacts-path .tmp/...` for backend builds.

### User can see no data

Check assigned site access and roles in the Users workspace.

### Approval rejected

Some workflows reject self-approval. Use a second eligible user with the required role and site access.
