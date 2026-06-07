# Product verification tests

This folder contains two kinds of verification:

- API-level product flow scripts that run against a running PharmacyCentral Aspire stack.
- xUnit backend tests that verify payment/security logic directly in .NET.

## Prerequisites

1. Start the app through Aspire from the normal development terminal:

   ```bash
   aspire run
   ```

2. Wait for the API resource to become healthy.

## Run API product flow

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


Fresh/no-business-seed flow check:

```bash
PHARMACY_EXPECT_NO_BUSINESS_SEED=true node tests/fresh-product-flow-verify.mjs
```

Use this after starting a fresh development database with:

```text
PHARMACY_SEED_ADMIN_USER=true
PHARMACY_SEED_DEMO_USERS=false
PHARMACY_SEED_BUSINESS_DATA=false
```

## Run xUnit backend tests

```bash
dotnet test PharmacyCentral.sln --artifacts-path .tmp/tests/dotnet-artifacts
```

Payment/invoice verification belongs here when the logic can be tested directly without a browser or external provider callback.

## Coverage

The suite creates uniquely named test users and records, then verifies:

- login success and failed-login rejection
- no-role user blocking
- assigned-site filtering and cross-site denial
- password change, admin reset, and session revocation
- pricing publish, active lookup, overlap guard, and archive
- finance valuation and operational reconciliation
- purchase order approval and receipt matching
- receiving creates a batch, inventory balance, and history entry
- quality release and quality rejection controls
- FEFO allocation and insufficient-stock rejection
- prescription reservation, retry safety, and dispensing lifecycle
- transfer approval by a second user, shipment, and receipt
- return/removal stock decrease
- stocktake variance posting
- standalone stock adjustment approval by a second user
- recall blocking and affected-batch action tracking
- dashboard/reporting sanity after the workflow

The fresh flow script additionally verifies the first operational order from a minimal baseline: admin login, site/location setup, role-specific user creation, manager procurement/pricing, warehouse receiving/quality/transfer, pharmacist dispensing/return, and admin/manager visibility checks.

The fresh flow also confirms that first-administrator setup is disabled after a Platform Admin exists. To manually validate the first-run administrator form, start with a disposable database and `PHARMACY_SEED_ADMIN_USER=false`.

The scripts mutate only development data and do not create migrations or change schema.

The xUnit backend tests cover payment code generation, invoice line snapshots, provider-neutral payment transaction shape, SePay HMAC verification and server-side QR URL generation.
