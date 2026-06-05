# Product verification tests

These tests exercise product behavior against a running PharmacyCentral Aspire stack. They are intentionally API-level tests: they verify user-visible workflows, access boundaries, and operational state changes without adding a separate test database schema.

## Prerequisites

1. Start the app through Aspire from the normal development terminal:

   ```bash
   aspire run
   ```

2. Wait for the API resource to become healthy.

## Run

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

## Coverage

The suite creates uniquely named test users and records, then verifies:

- login success and failed-login rejection
- no-role user blocking
- assigned-site filtering and cross-site denial
- pricing publish, active lookup, overlap guard, and archive
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

The script mutates only development data and does not create migrations or change schema.
