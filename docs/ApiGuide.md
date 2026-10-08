# Pharmacy Central API Guide

Production clients send requests to `/api` routes on AWS API Gateway HTTP API. Local Compose clients send the same paths through the development-only Nginx gateway. Both ingress paths strip the `/api` prefix before forwarding to the corresponding service. The AWS configuration under `deploy/aws` is configuration-only and no AWS resources were deployed.

## Authentication

- `GET /api/auth/setup-status`
- `POST /api/auth/setup-admin`
- `POST /api/auth/register`
- `GET /api/auth/verify-email`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/csrf`
- `GET /api/auth/context`

Authenticated browser mutations send the `pharmacy_session` cookie and `X-CSRF-TOKEN`. Authenticated service calls add the per-service token from `GET /api/auth/context` as `x-internal-identity-context`. Locally `identity-service` mints these tokens for the browser session; in production the Lambda authorizer mints them instead. Guest cart mutations use the `pharmacy_guest_cart` cookie. The Lambda Authorizer verifies session state with `identity-service`, sets `x-actor-id` and `x-actor-type`, and injects HMAC-signed `x-internal-identity-context`, discarding any client-supplied identity headers.

## Customer catalog and sales

- `GET /api/products`, `GET /api/products/{id}`, `GET /api/products/{id}/units`
- `GET /api/stores`, `GET /api/stores/nearest`
- `GET /api/pricing/active`
- `GET /api/carts`
- `POST /api/carts/lines`
- `PATCH /api/carts/lines/{id}`
- `DELETE /api/carts`
- `POST /api/carts/merge`
- `POST /api/delivery/calculate`
- `GET /api/delivery/addresses`
- `POST /api/delivery/addresses`
- `DELETE /api/delivery/addresses/{id}`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/{id}`
- `POST /api/orders/{id}/transition`

`POST /api/orders` accepts product and unit IDs, quantity, selected store, and pickup or delivery choice. `sales-service` recalculates active prices and delivery server-side. Delivery snapshots contain the provider-resolved address, separate customer note, road distance, duration, fee, and GeoJSON route.

## Prescription intake

A signed-in customer turns a printed prescription into suggested catalog products. Nothing is stored and nothing is added to a cart; the web page `/gui-don-thuoc` shows the suggestions and the customer adds products explicitly.

- `POST /api/prescriptions/intake/image` takes the raw image bytes with `Content-Type: image/jpeg`, `image/png`, or `image/webp` (the bytes must match the type, 8 MB at most). `sales-service` sends the photo to Gemini, which returns the prescription header and one entry per medicine.
- `POST /api/prescriptions/intake/qr` takes `{ "payload": "<text of the QR>" }`. The payload is JSON with `ma_don_thuoc` (the 14 character prescription code, for example `a1b2c3d4e5f6-C`) and `thong_tin_don_thuoc`, an array of `{ ten_thuoc, biet_duoc, don_vi_tinh, so_luong, cach_dung }`. These are the field names of the national e-prescription API (donthuocquocgia.vn), whose pharmacy lookup by code needs vendor credentials; until those exist the QR carries the items inline.

Both answer `{ source, prescription, lines }`. Each line is `{ extracted, matches }`: `extracted` is the medicine as read (`rawText`, `name`, `activeIngredients`, `strength`, `dosageForm`, `quantity`, `unit`, `usage`) and `matches` holds up to five catalog products, best first, each with `matchType` (`name` or `ingredient`), `strengthMatch` (`true`, `false`, or `null` when either side states no strength), a `score` from 0 to 1, and the product as `GET /api/products/{id}` returns it.

Errors are problem JSON: `401` not signed in, `400 invalid_image` or `invalid_qr`, `413` photo over 8 MB (no `code`), `422 not_a_prescription` or `unreadable_prescription`, `429 rate_limited` with `Retry-After` (photo reading allows 5 photos per minute and 30 per day per account, counted over sliding windows), `502 reader_failed` (Gemini failed or was throttled) or `catalog_unavailable`, `503 reader_unavailable` (photo reading is off because `GEMINI_API_KEY` is empty; QR intake still works) or `rate_limit_unavailable` (Valkey is down, so no photo is sent to Gemini). The `400`, `422`, `429`, `502`, and `503 reader_unavailable` answers carry a Vietnamese `detail`. Only the photo route is rate limited, because only it calls a metered provider.

The web page asks for explicit consent before it uploads a photo, because the photo leaves the system for Gemini. A QR is decoded in the browser and needs no consent.

`catalog-service` serves the matching at `POST /products/match` with `{ items: [{ name, activeIngredients, strength }], limit }` and answers one `{ matches }` entry per item, in order. It scores trigram similarity on accent-folded text (`pg_trgm`, `unaccent`) against the product name, generic name, and active ingredient, then moves the exact strength ahead of other strengths of the same drug.

## Staff sales and inventory

- `GET /api/prescriptions`
- `POST /api/prescriptions`
- `GET /api/prescriptions/{id}`
- `POST /api/prescriptions/{id}/cancel`
- `POST /api/prescriptions/{id}/dispense`
- `GET /api/counter-transactions`
- `GET /api/inventory/balances`
- `GET /api/inventory/batches`
- `POST /api/inventory/batches`
- `POST /api/inventory/reservations`
- `POST /api/inventory/reservations/{id}/release`
- `POST /api/inventory/reservations/{id}/consume`
- `POST /api/inventory/movements`
- `POST /api/inventory/transfers`
- `POST /api/inventory/stocktakes`
- `POST /api/inventory/returns`
- `POST /api/inventory/replenishment`

Prescription creation reserves FEFO stock through `inventory-service`. Cancellation releases the reservation. Dispensing consumes the reservation and records the prescription status transition.

## Procurement and catalog administration

- `/api/procurement/purchase-orders`
- `/api/procurement/goods-receipts`
- `/api/sites`
- `/api/storage-locations`
- `/api/products`
- `/api/suppliers`
- `/api/pricing/prices`
- `/api/availability`

Employee route groups require an employee session. Site-scoped authorization remains a service-level responsibility where a write use case requires it.

## Payments

- `POST /api/payments/invoices`
- `POST /api/payments/prescriptions/{prescriptionId}`
- `GET /api/payments/invoices`
- `GET /api/payments/{id}`
- `GET /api/payments/{id}/invoice`
- `POST /api/payments/{id}/confirm-counter`
- `POST /api/payments/{id}/refund`
- `GET /api/payments/{id}/reconciliation`
- `POST /api/payments/sepay/webhook`

Payment invoices snapshot line prices. QR attempts use provider-neutral invoice data and configured SePay VietQR instructions. SePay webhooks use a passthrough integration at API Gateway that preserves raw request bytes, verify `x-sepay-signature` (HMAC-SHA256 over `${x-sepay-timestamp}.${rawBody}`) in `payment-service`, answer `200 {"success": true}` for every verified delivery, accept inbound transfers only, match payment code and amount, and deduplicate provider transaction IDs.

## Query projections

- `GET /api/dashboard/summary`
- `GET /api/finance/summary`
- `GET /api/reports`
- `GET /api/audit/logs`

These endpoints read only `operations-query-service` projections. Projection lag is observable and does not change write-model truth.
