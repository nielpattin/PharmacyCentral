# Pharmacy Central API Guide

The API is exposed under `/api` from `Web.Api`.

Development HTTPS endpoint is usually:

```text
https://localhost:7528/api
```

Use the actual Aspire resource URL if it differs.

## Authentication and CSRF

The API uses cookie authentication and antiforgery validation for unsafe requests.

Important rules:

- Use HTTPS for CSRF in development.
- Get a CSRF token before login.
- Login with the token and session cookie.
- Fetch a fresh CSRF token after login before POST/PUT/PATCH/DELETE requests.
- Send the token in `X-CSRF-TOKEN`.

Example with `curl`:

```bash
BASE=https://localhost:7528/api
COOKIE=.tmp/api-cookies.txt

curl -k -c "$COOKIE" "$BASE/auth/csrf"
TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" -c "$COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-TOKEN: $TOKEN" \
  -d '{"email":"admin@pharmacy.local","password":"Admin@123!","rememberMe":false}' \
  "$BASE/auth/login"

TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" "$BASE/auth/me"
```

## Idempotency

Prescription creation and dispensing accept an `Idempotency-Key` header. Reusing the same key for a successful request returns the same successful response instead of performing the operation twice.

Example:

```bash
-H "Idempotency-Key: prescription-create-2026-01-01-001"
```

## Authorization model

Endpoints enforce role policies and site access server-side.

| Policy area | Typical roles |
| --- | --- |
| Any app role | Platform Admin, Pharmacy Manager, Pharmacist, Warehouse Staff |
| Management | Platform Admin, Pharmacy Manager |
| Store | Platform Admin, Pharmacy Manager, Pharmacist |
| Warehouse | Platform Admin, Warehouse Staff |
| Platform Admin | Platform Admin |

Non-admin users can only access assigned-site data.

## Common endpoints

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Returns antiforgery token |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user, roles, assigned sites |
| POST | `/api/auth/register` | Development/internal registration path |
| POST | `/api/auth/change-password` | Change the current user's password |

### Admin users

| Method | Path |
| --- | --- |
| GET | `/api/admin/users` |
| POST | `/api/admin/users` |
| GET | `/api/admin/roles` |
| PUT | `/api/admin/users/{id}/access` |
| POST | `/api/admin/users/{id}/reset-password` | Reset a user's password |
| POST | `/api/admin/users/{id}/revoke-sessions` | Sign out a user's active sessions |

### Dashboard, reporting, and audit

| Method | Path |
| --- | --- |
| GET | `/api/dashboard/summary` |
| GET | `/api/audit/logs` |

### Master data

| Area | Paths |
| --- | --- |
| Sites | `/api/sites`, `/api/sites/{id}` |
| Storage locations | `/api/storage-locations`, `/api/storage-locations/{id}` |
| Products | `/api/products`, `/api/products/{id}` |
| Suppliers | `/api/suppliers`, `/api/suppliers/{id}` |

### Pricing

| Method | Path |
| --- | --- |
| GET | `/api/pricing/prices` |
| POST | `/api/pricing/prices` |
| POST | `/api/pricing/prices/{id}/publish` |
| POST | `/api/pricing/prices/{id}/archive` |
| GET | `/api/pricing/active?productId={id}&siteId={id}&effectiveDate=2031-06-01` |

### Procurement and receiving

| Method | Path |
| --- | --- |
| GET | `/api/purchase-orders` |
| POST | `/api/purchase-orders` |
| GET | `/api/purchase-orders/{id}` |
| POST | `/api/purchase-orders/{id}/approve` |
| POST | `/api/purchase-orders/{id}/cancel` |
| GET | `/api/goods-receipts` |
| POST | `/api/goods-receipts` |

### Inventory

| Method | Path |
| --- | --- |
| GET | `/api/inventory/balances` |
| GET | `/api/inventory/ledger` |
| POST | `/api/inventory/movements` |
| POST | `/api/inventory/fefo-allocate` |

### Quality and recall

| Method | Path |
| --- | --- |
| POST | `/api/quality/batches/{batchId}/release` |
| POST | `/api/quality/batches/{batchId}/reject` |
| GET | `/api/recalls` |
| POST | `/api/recalls` |
| POST | `/api/recalls/{id}/activate` |
| POST | `/api/recalls/{id}/close` |
| POST | `/api/recalls/{id}/cancel` |
| POST | `/api/recalls/{id}/batches/{affectedBatchId}/action` |

### Prescriptions

| Method | Path |
| --- | --- |
| GET | `/api/prescriptions` |
| POST | `/api/prescriptions` |
| GET | `/api/prescriptions/{id}` |
| POST | `/api/prescriptions/{id}/dispense` |
| POST | `/api/prescriptions/{id}/cancel` |

### Transfers

| Method | Path |
| --- | --- |
| GET | `/api/transfers` |
| POST | `/api/transfers` |
| GET | `/api/transfers/{id}` |
| POST | `/api/transfers/{id}/approve` |
| POST | `/api/transfers/{id}/ship` |
| POST | `/api/transfers/{id}/receive` |
| POST | `/api/transfers/{id}/cancel` |

### Returns/removals

| Method | Path |
| --- | --- |
| POST | `/api/returns` |

### Stocktake and adjustments

| Method | Path |
| --- | --- |
| GET | `/api/stocktakes` |
| POST | `/api/stocktakes` |
| GET | `/api/stocktakes/{id}` |
| POST | `/api/stocktakes/{id}/counts` |
| POST | `/api/stocktakes/{id}/post-adjustments` |
| GET | `/api/stock-adjustments` |
| POST | `/api/stock-adjustments` |
| POST | `/api/stock-adjustments/{id}/approve` |

## Example: create a product

```bash
TOKEN=$(curl -ks -b "$COOKIE" -c "$COOKIE" "$BASE/auth/csrf" | jq -r .token)

curl -k -b "$COOKIE" -c "$COOKIE" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-TOKEN: $TOKEN" \
  -d '{
    "sku":"DEMO-001",
    "name":"Demo product",
    "category":"Demo",
    "unit":"box",
    "manufacturer":"Demo manufacturer",
    "status":"Active",
    "notes":"Created from API guide.",
    "isActive":true
  }' \
  "$BASE/products"
```

## Error handling

The API returns standard HTTP statuses. Common responses:

- `400` validation or business rule rejection
- `401` unauthenticated
- `403` missing role, missing site access, or invalid CSRF token
- `404` not found
- `409` conflict where applicable
- `500` unexpected server error
