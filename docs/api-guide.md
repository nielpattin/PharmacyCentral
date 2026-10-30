# Pharmacy Central API Guide

Production clients send requests to `/api` routes on AWS API Gateway HTTP API. Local Compose clients send the same paths through the development-only Nginx gateway. Both ingress paths strip the `/api` prefix before forwarding to the corresponding service. The AWS configuration under `deploy/aws` is configuration-only and no AWS resources were deployed.

## Authentication

- `GET /api/auth/setup-status`
- `POST /api/auth/setup-admin`
- `POST /api/auth/register`
- `GET /api/auth/verify-email`
- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/csrf`
- `GET /api/auth/context`

Authenticated browser mutations send the `pharmacy_session` cookie and `X-CSRF-TOKEN`. Authenticated service calls add the per-service token from `GET /api/auth/context` as `x-internal-identity-context`. Locally `identity-service` mints these tokens for the browser session; in production the Lambda authorizer mints them instead. A signed-out cart stays in the browser and has no server copy; `POST /api/carts/merge` moves the browser cart into the signed-in account. The Lambda Authorizer verifies session state with `identity-service`, sets `x-actor-id` and `x-actor-type`, and injects HMAC-signed `x-internal-identity-context`, discarding any client-supplied identity headers.

The Google routes answer `503 google_not_configured` when Google sign-in is not configured. The callback answers `400 invalid_oauth_state` when the `state` query value does not match the `oauth_state` cookie.

Credential routes are rate limited: `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`, and `GET /api/auth/verify-email`. Each is a sliding window of `AUTH_RATE_LIMIT_WINDOW_SECONDS` seconds with up to `AUTH_RATE_LIMIT_MAX_ATTEMPTS` attempts. On `POST /api/auth/login` only failed sign-ins count: a successful sign-in gives its attempt back, so a shopper who signs in normally never reaches the limit. The other four routes count every attempt. The bucket is the email (or the account id on the two token routes) together with the client address identity-service sees behind the gateway. The limit applies whether or not the account exists, so a refused request reveals nothing about the address. A refused attempt answers `429` with `code: "rate_limited"`, a `Retry-After` header in whole seconds, and the usual `{ title, status, code }` body, and it records nothing. The check runs before the password or token is read. When the Redis counter cannot be read or written, the route answers `503 rate_limit_unavailable` and processes nothing. `setup-admin` and `change-password` are not limited: the first is a one-time bootstrap and the second already requires a session.

## Accounts and administration

Employee roles are `Platform Admin`, `Pharmacy Manager`, `Pharmacist`, and `Warehouse Staff`.

Admin routes require a signed-in account with the `Platform Admin` role. A request with no session answers `401 unauthenticated`, and any other account answers `403 forbidden`.

`POST /api/auth/login` takes `{ email, password, audience? }`. Staff Web sends `audience: "employee"`: a customer account then answers `403 employee_required` before any session cookie is set. An employee account signs in with its password, so a Google sign-in for one answers `403 password_sign_in_required`. A deactivated account gets the same `401` as a wrong password. A failed employee sign-in is audited as `identity.auth.login-failed` with its reason, never its password.

While an account must change its password, the edge refuses every route except the auth routes, and `GET /api/auth/context` and `PATCH /api/auth/me` answer `403 password_change_required`. `POST /api/auth/change-password` clears the flag and the session cookie.

- `GET /api/admin/roles` lists the employee roles.
- `GET /api/admin/users` lists employee accounts. `status=active` or `status=deactivated` narrows the list.
- `POST /api/admin/users` creates an employee account and answers `201`. The account must change its password at its first sign-in. `roles` needs at least one role (`400 role_required`), and every role except Platform Admin needs at least one site (`400 site_required`).
- `PUT /api/admin/users/{id}/access` takes `{ "roles", "siteIds" }`, follows the same rules as create, and answers the account. It refuses the caller's own account (`403 self_change_forbidden`) and any change that leaves no active Platform Admin (`409 last_platform_admin`).
- `POST /api/admin/users/{id}/reset-password` takes `{ "password" }` (12 to 200 characters) and answers `204`. The account must change the password at its next sign-in, and all its sessions end. A deactivated account answers `409 account_deactivated`. The caller's own account is refused (`403 self_change_forbidden`).
- `POST /api/admin/users/{id}/revoke-sessions` answers `204`. The caller's own account is refused (`403 self_change_forbidden`).
- `POST /api/admin/users/{id}/deactivate` answers `204`. The account cannot sign in, its sessions end in the same transaction, and no data is deleted. The caller's own account and the last active Platform Admin are refused as above.
- `POST /api/admin/users/{id}/activate` answers `204`.
- `GET /api/auth/staff-directory` lists the active employees as `{ employees: [{ id, displayName, roles, siteIds }] }`, never an email. Platform Admin gets every one; a Pharmacy Manager gets those who share a site with them; any other caller answers `403`. Staff Web uses it for the owner picker of action plans.

An id that is not an employee account answers `404 employee_not_found`. Every change is audited with the administrator as actor.

- `GET /api/customers/lookup?q=` searches customer accounts for the counter's prescription linking. It is a Pharmacist's route; Platform Admin reads it like every staff route (BR-AUTH-010). Any other staff role gets `403`, and so does a shopper.

`GET /internal/customers/{id}` and `POST /internal/customers/batch` (`{ "ids" }`, up to 200, answers `{ "customers" }`) are served by `identity-service` for service-to-service lookups only. They require the system actor, and no gateway routes them. sales-service calls the batch route to add customer names and phones to staff order lists.

## Refusal codes

Problem bodies carry a `code`. A role refusal by the edge is a bare `403` with no code; the service that owns the route answers the codes below.

| Code | Status | Meaning |
| --- | --- | --- |
| `role_forbidden` | 403 | The caller's roles do not allow the action, or the caller is Platform Admin and the write is not one its allow-list names: users, roles and site access, audit, AI integrations, the System page, creating or deleting a site, and reassigning an action plan (BR-AUTH-010). |
| `site_access_denied` | 403 | The record belongs to a site outside the caller's sites. |
| `self_approval_forbidden` | 403 | The approver created, counted or submitted the record. Applies to every role (BR-AUTH-009). |
| `password_change_required` | 403 | The account must change its password before it does anything else. |
| `self_change_forbidden` | 403 | An administrator acted on their own account. |
| `employee_required` | 403 | A customer account signed in at staff sign-in. |
| `password_sign_in_required` | 403 | An employee account tried to sign in with Google. |
| `role_required` | 400 | An employee account was given no role. |
| `site_required` | 400 | A non-Platform-Admin employee was given no site. |
| `location_site_fixed` | 400 | A storage location's site cannot be changed. |
| `last_platform_admin` | 409 | The change would leave no active Platform Admin. |
| `account_deactivated` | 409 | The account is deactivated, so its password cannot be reset. |
| `in_use` | 409 | A site or product is still referenced and cannot be deleted. |
| `employee_not_found` | 404 | The id is not an employee account. |
| `identity_unavailable` | 503 | A staff order list could not read customer names and phones from identity-service. |

## Customer catalog and sales

Every `/api/carts*` route needs a signed-in customer. A signed-out shopper's cart is kept in the browser and the server never sees it until sign-in ([ADR 0014](adr/0014-signed-out-cart-in-the-browser.md)).

- `GET /api/products`, `GET /api/products/{id}`, `GET /api/products/{id}/units`

`GET /api/products` takes `search`, `category`, `prescriptionRequired`, `limit` (1 to 100, default 20) and `cursor`. The body is the plain array of one page. When another page follows, the answer carries its cursor in the `X-Next-Cursor` header; send it back as `cursor` with the same other parameters. The last page has no header. A cursor is opaque and a malformed one answers `400`. Answers are kept for up to 30 seconds per query and page, so a product change made through another replica can take that long to show.

`GET /api/products` is served by `search-service`, a Go service that reads only the Typesense product index. Its path, query parameters, cursor, `X-Next-Cursor` header, product objects and `400` problem body are the same as those `catalog-service` returns. When the index is unavailable, the request is passed on to `catalog-service`, which answers it from PostgreSQL. Every other `/api/products` route is served by `catalog-service`.

`GET /api/products/count` is served by `catalog-service` and answers `{ "count": n }`: the active products the product list shows, under the same optional `search`, `category` and `prescriptionRequired` filters. It is a count of the catalog itself, not of the search index.

- `GET /api/stores`, `GET /api/stores/nearest`, `GET /api/stores/:id`
- `GET /api/pricing/active`
- `GET /api/carts`
- `POST /api/carts/lines` (a product the catalog marks `prescriptionRequired` answers `409 prescription_required` with its `productId` and is not added)
- `PATCH /api/carts/lines/{id}`
- `PATCH /api/carts/selection` (body `{ "selected": true|false, "lineIds": ["…"] }`; ticks or unticks those lines of the caller's own cart for the next order, or every line when `lineIds` is left out. An empty `lineIds` list or a missing `selected` answers `400`. A cart answer lists each line with `selected`; a new line starts `false`.)
- `DELETE /api/carts` (empties the caller's cart)
- `POST /api/carts/merge` (body `{ "lines": [{ "productId": "…", "productUnitId": "…", "quantity": 1, "selected": false }] }`, 1 to 200 lines; moves the browser cart into the caller's cart and answers it. A line that matches one already in the cart adds its quantity and keeps the cart line's tick; any other line is added with the tick it was sent with. A missing, empty or oversized `lines` answers `400`.)
- `POST /api/delivery/calculate`
- `POST /api/delivery/reverse-geocode`
- `GET /api/delivery/addresses/search?q=`
- `POST /api/delivery/addresses/resolve`
- `GET /api/delivery/addresses`
- `POST /api/delivery/addresses`
- `PATCH /api/delivery/addresses/{id}`
- `DELETE /api/delivery/addresses/{id}`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/{id}`
- `POST /api/orders/{id}/transition`

`POST /api/orders` accepts the selected store, the pickup or delivery choice, and exactly one of `lines` (product and unit IDs with quantities) or `fromCart: true`. With `fromCart` the server orders the caller's ticked cart lines, takes the quantities from the cart, and removes those lines once the stock is held; no ticked line answers `409 cart_selection_empty`, and a refused order leaves the cart untouched. An order that includes a product marked `prescriptionRequired` answers `409 prescription_required` with its `productId`, for `lines` and `fromCart` alike. Sending both, or neither, answers `400`. `sales-service` recalculates active prices and delivery server-side. Delivery snapshots contain the provider-resolved address, separate customer note, road distance, duration, fee, and GeoJSON route.

`GET /api/orders` answers the signed-in shopper's own orders. A staff session answers the orders at its sites (Platform Admin: all), narrowed by `status` and `paymentStatus`. `GET /api/orders/{id}` answers `404` for an order that belongs to another customer.

`GET /api/orders` takes `status`, `paymentStatus`, `limit` (default 100, at most 500), `cursor`, and `q`. The body is the plain array of one page, newest first. `q` is a case-insensitive substring match over the order id only: sales-service stores no customer name, phone, or order number, and those live with identity-service. When another page follows, the answer carries its cursor in the `X-Next-Cursor` header; send it back as `cursor` with the same other parameters. The last page has no header. A cursor is opaque, and a malformed one answers `400 invalid_cursor` (problem JSON). A staff row carries `customer` (`{ displayName, phoneNumber }`, or `null` when the account is not found), read from identity-service. If identity-service does not answer, a staff list answers `503 identity_unavailable`.

`POST /api/orders/{id}/transition` takes `{ "status" }`, one of `Confirmed`, `Preparing`, `Ready`, `Delivering`, `Completed`, or `Cancelled`. A Pharmacist or Pharmacy Manager moves orders at their sites (`403 site_access_denied` otherwise); Platform Admin reads them and cannot move one (`403 role_forbidden`). A shopper may only cancel their own order while it is `Pending` and unpaid; any other shopper move answers `403 forbidden`. A move the status chain does not have answers `409 invalid_transition`. A staff move that the order's money or fulfillment forbids answers `409` with a `code`: `pickup_not_delivered`, `delivery_not_collected` (a delivery order goes `Ready` → `Delivering` → `Completed`), `payment_confirms_order` (a QR order is confirmed by its payment), `paid_order_needs_refund` (cancel a paid order by refunding it) and `cash_not_recorded` (a cash-on-delivery order completes after `POST /api/payments/{id}/confirm-counter`).

`POST /api/delivery/reverse-geocode` takes `{ "destination" }`, and `GET /api/delivery/addresses/search` requires `q` of 2 to 200 characters. `POST /api/delivery/addresses/resolve` takes `{ "refId" }`. Each answers `400 invalid_request` when its body or query fails validation.

## Prescription intake

A signed-in customer turns a printed prescription into suggested catalog products. Nothing is stored and nothing is added to a cart; the web page `/gui-don-thuoc` shows the suggestions and the customer adds products explicitly.

- `POST /api/prescriptions/intake/image` takes the raw image bytes with `Content-Type: image/jpeg`, `image/png`, or `image/webp` (the bytes must match the type, 8 MB at most). `sales-service` sends the photo to the configured reader provider (today Gemini), which returns the prescription header and one entry per medicine.
- `POST /api/prescriptions/intake/qr` takes `{ "payload": "<text of the QR>" }`. The payload is JSON with `ma_don_thuoc` (the 14 character prescription code, for example `a1b2c3d4e5f6-C`) and `thong_tin_don_thuoc`, an array of `{ ten_thuoc, biet_duoc, don_vi_tinh, so_luong, cach_dung }`. These are the field names of the national e-prescription API (donthuocquocgia.vn), whose pharmacy lookup by code needs vendor credentials; until those exist the QR carries the items inline.

Both answer `{ source, prescription, lines }`. Each line is `{ extracted, matches }`: `extracted` is the medicine as read (`rawText`, `name`, `activeIngredients`, `strength`, `dosageForm`, `quantity`, `unit`, `usage`) and `matches` holds up to five catalog products, best first, each with `matchType` (`name` or `ingredient`), `strengthMatch` (`true`, `false`, or `null` when either side states no strength), a `score` from 0 to 1, and the product as `GET /api/products/{id}` returns it.

Errors are problem JSON: `401` not signed in, `400 invalid_image` or `invalid_qr`, `413` photo over 8 MB (no `code`), `422 not_a_prescription` or `unreadable_prescription`, `429 rate_limited` with `Retry-After` (photo reading allows 5 photos per minute and 30 per day per account, counted over sliding windows), `502 reader_failed` (the reader provider failed or was throttled) or `catalog_unavailable`, `503 reader_unavailable` (photo reading is off because no provider settings are available for it, saved or from `AI_PRESCRIPTION_READER_*`; QR intake still works) or `rate_limit_unavailable` (Redis is down, so no photo is sent to the reader provider). The `400`, `422`, `429`, `502`, and `503 reader_unavailable` answers carry a Vietnamese `detail`. Only the photo route is rate limited, because only it calls a metered provider.

The web page asks for explicit consent before it uploads a photo, because the photo leaves the system for the reader provider. A QR is decoded in the browser and needs no consent.

`catalog-service` serves the matching at `POST /products/match` with `{ items: [{ name, activeIngredients, strength }], limit }` and answers one `{ matches }` entry per item, in order. It scores trigram similarity on accent-folded text (`pg_trgm`, `unaccent`) against the product name, generic name, and active ingredient, then moves the exact strength ahead of other strengths of the same drug. `sales-service` calls this route with the service identity; it is not a browser route.

## Prescription consultations

A signed-in customer may send a prescription consultation to the pharmacy. Every route answers `401 unauthenticated` without an identity.

- `POST /api/prescriptions/consultations` creates a consultation for the signed-in customer.
- `GET /api/prescriptions/consultations` lists consultations for the requester.
- `POST /api/prescriptions/consultations/{id}/answer` records the pharmacist's answer.

A consultation whose site cannot be verified answers `503 catalog_unavailable`, and nothing is written.

`GET /api/prescriptions/consultations` takes `status`, `limit` (1 to 200, default 50), `cursor`, and `q`, and `siteId` for staff only. The body is the plain array of one page, newest first. `q` is a case-insensitive substring match over the patient's name and the prescription code, as stored in the consultation. When another page follows, the answer carries its cursor in the `X-Next-Cursor` header, and the last page has none. A malformed cursor answers `400 invalid_cursor`.

## Staff sales and inventory

- `GET /api/prescriptions`
- `GET /api/prescriptions/count`
- `POST /api/prescriptions`
- `GET /api/prescriptions/{id}`
- `POST /api/prescriptions/{id}/cancel`
- `POST /api/prescriptions/{id}/dispense`
- `GET /api/counter-transactions`
- `GET /api/inventory/balances`
- `GET /api/inventory/batches`
- `POST /api/inventory/batches`
- `POST /api/inventory/batches/{id}/quality` takes `{ "decision": "release" | "reject", "notes"? }`. A Pharmacist or Pharmacy Manager decides; the batch's creator cannot (`403 self_approval_forbidden`).
- `GET /api/inventory/adjustments`
- `GET /api/inventory/adjustments/count`
- `POST /api/inventory/adjustments`
- `POST /api/inventory/adjustments/{id}/approve`
- `POST /api/inventory/adjustments/{id}/reject`
- `GET /api/inventory/movements`
- `GET /api/inventory/movements/summary`
- `POST /api/inventory/movements`
- `GET /api/inventory/reservations`
- `POST /api/inventory/reservations`
- `POST /api/inventory/reservations/{id}/release`
- `GET /api/inventory/transfers`
- `GET /api/inventory/transfers/count`
- `POST /api/inventory/transfers`
- `GET /api/inventory/transfers/{id}`
- `POST /api/inventory/transfers/{id}/approve`, `ship`, `receive`, or `cancel`
- `GET /api/inventory/stocktakes`
- `GET /api/inventory/stocktakes/count`
- `POST /api/inventory/stocktakes`
- `GET /api/inventory/stocktakes/{id}`
- `POST /api/inventory/stocktakes/{id}/post`
- `GET /api/inventory/returns`
- `POST /api/inventory/returns`
- `GET /api/inventory/replenishment`
- `POST /api/inventory/replenishment`
- `GET /api/inventory/replenishment/{id}`
- `POST /api/inventory/replenishment/{id}/approve`, `reject`, `cancel`, or `fulfill`
- `POST /api/inventory/imports/opening-balances`

Role gates on these routes are the rules in [business-rules.md](business-rules.md#4-quy-t%E1%BA%AFc-role-v%C3%A0-ph%C3%A2n-quy%E1%BB%81n) (BR-AUTH-002). Platform Admin reads every one of them and writes none: a write on these routes answers `403 role_forbidden` (BR-AUTH-010). By group: Warehouse Staff propose adjustments and Pharmacy Manager approves or rejects them; Warehouse Staff create, ship and receive transfers, a Pharmacy Manager approves one, and either may cancel; Warehouse Staff create and count stocktakes, and a Pharmacy Manager posts one; a Pharmacist or Pharmacy Manager requests replenishment and Warehouse Staff approve, reject or fulfil it; Warehouse Staff create returns and a Pharmacy Manager approves or rejects them. Approval never goes to the record's creator, counter or requester (`403 self_approval_forbidden`).

Inventory lists page by cursor where they take `limit` and `cursor`. The next page's cursor travels in the `X-Next-Cursor` header, present only while another page follows. A malformed cursor answers `400 invalid_cursor`. An out-of-range `limit` is clamped to its range; a non-numeric one takes the default.

- `transfers`, `adjustments`, `stocktakes`, and `replenishment` take `status` (comma-separated, such as `status=PendingApproval,Draft`), `limit` (1 to 500, default 100), `cursor`, and `q`. They answer newest first by creation time, with the id breaking ties. `q` is a case-insensitive substring match: the transfer number on transfers; the reason, notes, or batch number on adjustments; the notes or a line's batch number on stocktakes and replenishment requests.
- `movements` takes `productId`, `productBatchId`, `storageLocationId`, `from`, `to` (ISO 8601 timestamps; both bounds are inclusive on `occurredAt`), `limit` (1 to 500, default 500), and `cursor`. It answers newest first by `(occurredAt, id)`.
- `balances` and `batches` answer every row, in expiry order, when neither `limit` nor `cursor` is sent. With `limit` (1 to 500, default 100) or `cursor` they page in the same order, ties broken by id. `q` matches the batch number. Balances carry no SKU locally (the catalog owns it), so SKU search is not offered here.
- `returns` answers every row, newest first, when neither `limit` nor `cursor` is sent. With `limit` or `cursor` it pages.

`GET /api/inventory/transfers/count`, `GET /api/inventory/adjustments/count`, `GET /api/inventory/stocktakes/count`, and `GET /api/procurement/goods-receipts/count` answer `{ "count": n }` from `COUNT(*)`, with no cap. They take the same site scope, `status`, `excludeStatus` (where the list has a status), and `q` as their list, so a count answers the list it sits beside.

`POST /api/inventory/reservations/{id}/consume` and `POST /api/inventory/dispenses` accept only the system actor that `sales-service` sends. A browser request answers `403 forbidden`. Stock leaves only when the sale that records it is handed over.

Prescription creation reserves FEFO stock through `inventory-service`. A reservation that cannot be met answers `409 insufficient_stock` from inventory. Cancellation releases the reservation. Dispensing consumes the reservation and records the prescription status transition.

`GET /api/prescriptions` takes `status`, `limit` (default 100, at most 500), `cursor`, and `q`. It answers the plain array of one page, newest first, and each prescription carries its `lines`. Staff see the prescriptions of their own sites; a shopper sees only the records linked to their account. `q` is a case-insensitive substring match over the prescription number, the patient's name, and the patient's phone. When another page follows, the answer carries its cursor in the `X-Next-Cursor` header, and the last page has none. A malformed cursor answers `400 invalid_cursor`.

`GET /api/prescriptions/count` answers `{ "count" }`, the number of prescriptions the same filters select: `status` (one state), the caller's site scope, and `excludeStatus`, a comma-separated list of states to leave out, such as `Dispensed,Cancelled` for the open register. The states are `Draft`, `Pending`, `PartiallyDispensed`, `Dispensed`, and `Cancelled`; any other name answers `400 invalid_request`. It is a SQL `COUNT(*)`, so it never depends on a page size. Shoppers get `403`, and a request with no identity gets `401`. Service callers such as operations-query-service need no actor header of their own.

`GET /api/counter-transactions` takes `paymentStatus` (the prescription state it maps to), `limit` (default 100, at most 500), `cursor`, and `q`, and answers the same paged prescription rows as `GET /api/prescriptions`. The route shares that query, so the answer is a list of prescriptions and not a list of counter receipts. Staff only; a shopper gets `403`.

Action plans (BR-PLAN-001, BR-PLAN-002) live in `inventory-service`. The system creates the plan of every alert and assigns its owner (the active Pharmacist at the plan's site with the fewest `open` or `in_progress` plans, ties by name; the site's active Pharmacy Manager when the site has no Pharmacist; due 7 days after creation): a sweep at boot and every 15 minutes, with no route to call it, so a browser cannot trigger or skip it. It skips an alert that already has a live plan or a plan done in the last 7 days. The routes below read plans, let a Pharmacy Manager create one by hand, let the plan's owner move its status (`status` only), and let a Pharmacy Manager or Platform Admin change its `ownerId`, `dueDate` (not in the past) and `title`; `status` or `detail` from them, or any other field from the owner, is `403`. `GET /api/inventory/action-plans` takes `ownerId`, `status` (`open`, `in_progress`, `done`), `sourceType` (`replenishment`, `expiry`, `dead_stock`, `price_warning`), `siteId`, `q`, `limit` (default 100, at most 500) and `cursor`, and answers a plain array, newest first, with `X-Next-Cursor`. A Pharmacy Manager reads the plans of their sites and Platform Admin reads every plan; any other employee reads only plans they own. `POST /api/inventory/action-plans` (Pharmacy Manager only; any other role is refused) takes `{ sourceType, sourceRef, title, detail?, siteId?, productId?, ownerId, dueDate }` and answers `201` with the plan; an owner who is not an active employee answers `422 owner_not_found`, one who does not hold the site `422 owner_not_at_site`, a due date in the past `400`, and a second live plan for the same `sourceType` and `sourceRef` `409 plan_exists` with `planId`. `PATCH /api/inventory/action-plans/{id}` takes any of `status`, `ownerId`, `dueDate`, `title`, `detail`: a Pharmacy Manager or Platform Admin changes `ownerId` only, the plan's owner changes `status` only, and anything else answers `403`. A plan is `{ id, sourceType, sourceRef, title, detail, siteId, productId, ownerId, dueDate, status, createdBy, createdAt, updatedAt, completedAt }`.

`POST /api/inventory/imports/opening-balances` (Warehouse Staff only) takes `{ "schemaVersion", "balances" }` (at least one row, up to 25 MB) and is the import behind the staff-web Data import screen. The committed sample CSVs are in `data/import-samples/`.

## Procurement

- `GET /api/procurement/purchase-orders`
- `POST /api/procurement/purchase-orders`
- `GET /api/procurement/purchase-orders/{id}`
- `POST /api/procurement/purchase-orders/{id}/action` takes `{ "action": "approve" | "cancel", "notes"? }`. A Pharmacy Manager approves, never an order they created (`403 self_approval_forbidden`); cancel is for Pharmacy Manager.
- `GET /api/procurement/goods-receipts`
- `GET /api/procurement/goods-receipts/count`
- `POST /api/procurement/goods-receipts`
- `POST /api/procurement/goods-receipts` takes, on each line, an optional `unitCost` (VND per base unit received before VAT, from 0, at most 2 decimals, at most 1 000 000 000; omitted or `null` when unknown). Every receipt answer returns it as `unitCost: number | null` (BR-PROC-009).
- `GET /api/procurement/replenishment-suggestions` (Pharmacy Manager and Platform Admin read it) takes `siteId` (required), `windowDays` (default 30, 7 to 180), `coverDays` (14, 1 to 90), `safetyDays` (7, 0 to 60) and `defaultLeadTimeDays` (7, 1 to 90). It answers `{ siteId, params, generatedAt, suggestions: [{ productId, supplierId (null when unknown), dailyVelocity, dispensedQuantity, onHand, reserved, available, inboundQuantity, minimumStock, leadTimeDays, leadTimeSource (`history` or `default`), sampleCount, reorderPoint, targetStock, suggestedQuantity, daysOfCover }] }` (BR-PROC-007).
- `POST /api/procurement/replenishment-suggestions/draft-orders` (Pharmacy Manager only) takes `{ siteId, orders: [{ supplierId, lines: [{ productId, orderedQuantity }], notes? }] }`, one entry per supplier, whole-number quantities. It creates one `Draft` purchase order per entry in a single transaction and answers `201 { purchaseOrders }`; any failed reference creates nothing (BR-PROC-008).

Procurement routes check that the supplier, site, products, and storage location exist in `catalog-service` before a receipt is written.

`GET /api/procurement/purchase-orders` takes `status`, `q`, `limit` (1 to 500, default 100), and `cursor`, and answers newest first by creation time. `q` matches the purchase order number only: the supplier's name lives in `catalog-service`, so it is not searched here. `GET /api/procurement/goods-receipts` takes `q` (receipt number), `limit`, and `cursor`, and answers newest first by `receivedAt`, with the id breaking ties.

## Catalog administration

Public reads need no session: `/api/products` (except `search-synonyms` and the AI credential paths), `/api/stores`, `/api/availability`, `/api/pricing/active`, and `GET /api/pricing/prices?status=Published`. Every other read under `/sites`, `/storage-locations`, `/suppliers` and `/pricing` needs a signed-in employee. Writes are staff actions: a Pharmacy Manager writes them, and Platform Admin alone creates and deletes sites (any other caller gets `403`; Platform Admin editing an existing site, or any other write on these routes, also gets `403 role_forbidden`). A single-site employee sees only the storage locations of their own site. An update that would move a storage location to another site answers `400 location_site_fixed`; deleting a site or product that is still referenced answers `409 in_use`.

- `GET|POST /api/sites`, `GET|PUT|DELETE /api/sites/{id}`
- `GET|POST /api/storage-locations`, `GET|PUT|DELETE /api/storage-locations/{id}`
- `GET|POST /api/suppliers`, `GET|PUT|DELETE /api/suppliers/{id}`

- `POST /api/products/imports` takes the catalog import document (`schemaVersion` and the `sites` and product sections, defined in `apps/catalog-service/src/contracts/imports.ts`) and accepts up to 25 MB.
- `PUT /api/products/{id}/image` takes the raw image bytes (`image/jpeg`, `image/png`, or `image/webp`, 5 MB at most). It answers `503` when media storage is not configured.
- `GET /api/pricing/prices` takes `productId`, `status`, `q` (a case-insensitive match on the SKU or name of the price's product), `limit` (1 to 500, default 100), and `cursor`. Rows come newest first by `effectiveFrom`, ties broken by id. The body is the plain array of one page. When another page follows, `X-Next-Cursor` carries the cursor to send back as `cursor` with the same other parameters; the last page has no header. A malformed cursor answers `400` with `code: "invalid_cursor"`.
- `GET /api/pricing/prices/count` takes `productId`, `status`, and `q` as the price list does, and answers `{ "count": n }`.
- `GET /api/pricing/base-prices?day=YYYY-MM-DD` (default today, UTC) answers a plain array with one row per active product: `{ productId, productName, unitPrice }`. `unitPrice` is the price of one base unit effective on `day`, or `null` when no price qualifies. A price on a larger sale unit is divided by that unit's conversion factor; the base unit's own price wins over a larger unit's; then the latest effective date wins. Only site-less Published prices on a unit of their own product count. The answer is not paged, and an invalid `day` answers `400`.
- `POST /api/pricing/prices`
- `POST /api/pricing/prices/{id}/publish` or `archive`. Publish refuses the creator of the draft (`403 self_approval_forbidden`).
- `GET /api/pricing/active` answers the active price for a product unit at a site on a date.
- `GET /api/stores` takes `limit` (1 to 100, default 50) and `cursor`. Stores come in code order, and `X-Next-Cursor` works as it does for the price list. `GET /api/stores/nearest` answers the nearest stores to a point. `GET /api/stores/:id` answers one active, customer-facing store (`id`, `code`, `name`, `address`, `coordinates`), or `404`; sales-service reads it to place a delivery or pickup.
- `GET /api/availability`

`GET /api/sites`, `GET /api/storage-locations`, and `GET /api/suppliers` take `q`, a case-insensitive match on the code or the name (up to 200 characters; `%` and `_` match literally). Without `q` they answer the whole list in code order.

There is no single-product create route. Products enter the catalog through `POST /api/products/imports`, and `pnpm run seed:demo` uploads the sample images before it imports `products.csv`, so the `imageUrl` keys resolve. `data/` is never served by a web app or baked into a container image.

## Search synonyms

Staff maintain groups of search synonyms, such as a symptom and the words shoppers use for it. Each group has two to twenty terms. Each term is trimmed and has 1 to 60 characters. Two terms may not fold to the same text, so `Tiêu chảy` and `tieu chay` are one term too many.

- `GET /api/products/search-synonyms` lists the groups. Pending groups come first, then approved groups, newest submission first. The answer is `{ items }`.
- `POST /api/products/search-synonyms` creates a group from `{ "terms" }`. It answers `201` with the group in `pending`, at version 1.
- `PUT /api/products/search-synonyms/{id}` replaces the terms. It takes `{ "terms", "version" }`, and it answers `200` with the group in `pending`, at the next version.
- `POST /api/products/search-synonyms/{id}/approve` approves a group. It takes `{ "version" }`, and it answers `200` with the group in `approved`, at the next version.
- `DELETE /api/products/search-synonyms/{id}` removes a group. It answers `204`.

A group carries `id`, `terms`, `version`, `submittedBy`, `submittedAt`, and `status`. An approved group also carries `approvedBy` and `approvedAt`. The version starts at 1 and rises by one on every edit and approval.

A Pharmacist or Pharmacy Manager proposes, edits, approves and deletes a group; Platform Admin only reads the list, and a write from it answers `403 role_forbidden`. Any other signed-in account gets `403`, and a request with no identity gets `401`.

Review works as a four-eyes process. A creator or editor submits the group, and the group waits in `pending`. Only approved groups reach live search. An edit to an approved group returns it to `pending`, so it leaves live search until someone else approves it. The approver must differ from the last person who submitted the group, or the answer is `403 self_approval_forbidden`. Deleting a group takes effect at once, without review.

The problem bodies use these codes. `invalid_request` gives `400`. `search_synonym_not_found` gives `404`. `version_conflict` gives `409`, when the version in the request is not the current one. `already_approved` gives `409`, when the group is already approved. `self_approval_forbidden` gives `403`, when the approver is the last submitter.

After an approval, an edit of an approved group, or a delete of an approved group, the service pushes the approved set to the search index. A failed push is logged and does not fail the request. The next product search sweep pushes the set again.

## Payments

- `POST /api/payments/invoices`
- `POST /api/payments/prescriptions/{prescriptionId}` (Pharmacist only)
- `GET /api/payments/invoices`
- `GET /api/payments/invoices/{id}`
- `GET /api/payments/invoices/{id}/invoice`
- `GET /api/payments/{id}`
- `GET /api/payments/{id}/invoice`
- `POST /api/payments/{id}/confirm-counter` (Pharmacist only)
- `POST /api/payments/{id}/refund` takes `{ "reason" }` (1 to 500 characters). A counter invoice is refunded by a Pharmacist only; an online-order invoice by a Pharmacy Manager only. The wrong role answers `403 role_forbidden`.
- `GET /api/payments/{id}/reconciliation`
- `POST /api/payments/sepay/webhook`

Payment invoices snapshot line prices. A shopper invoice is priced from the order: its lines are the order lines, plus a `Phí giao hàng` line without a product when the order has a delivery fee, so the invoice amount equals the order total. `POST /api/payments/prescriptions/{prescriptionId}` builds a `sepay_qr` invoice from a prescription's lines and returns the existing invoice when one already exists. A shopper reads only their own invoices, and staff read any invoice. `GET /api/payments/invoices/{id}/invoice` and `GET /api/payments/{id}/invoice` return the printable form. An invoice that is not visible to the caller answers `404`.

`GET /api/payments/invoices` takes `status` (`Pending`, `Paid`, `Failed`, `Refunded` or `Cancelled`, matched exactly), `q` (a case-insensitive substring of the invoice number, the `orderId` or the `customerId`; `%` and `_` match themselves), `limit` (1 to 500; a larger value is clamped to 500) and `cursor`. Invoices are listed newest first by `(createdAt, id)`. With neither `limit` nor `cursor` the body is the whole filtered list, and no header is sent. With a `limit`, or with a `cursor` alone (default page size 100), the body is one page: when another page follows, `X-Next-Cursor` carries its cursor, and the last page has no header. Send the cursor back as `cursor` with the same other parameters. A malformed or tampered cursor answers `400` with `code: "invalid_cursor"`.

QR attempts use provider-neutral invoice data and configured SePay VietQR instructions. The SePay webhook is the only payment route that skips the gateway identity check. API Gateway passes its raw request bytes through unchanged. `payment-service` verifies `x-sepay-signature` (HMAC-SHA256 over `${x-sepay-timestamp}.${rawBody}`) and answers `401 invalid_signature` when verification fails. For every verified delivery it answers `200 {"success": true}`, because SePay records a delivery as successful only on that exact response. It accepts inbound transfers only, matches the payment code and amount, and deduplicates provider transaction IDs.

## Shopping assistant

A signed-in customer asks the shopping assistant inside a chat session. A session takes up to 20 questions. After that, the customer starts a new session. The assistant looks up products through catalog tools. It searches by need, name, or ingredient, and it reads the details of a product that already appeared in the conversation.

- `POST /api/chatbot/sessions` opens a session and answers `201 { "id" }`.
- `POST /api/chatbot/sessions/{sessionId}/messages` takes `{ "content" }` (1 to 1000 characters) and answers `{ reply, products }`.

The list holds at most five products, each once, in the order the assistant first found them.

A question that the intent gate classifies as a greeting, an out of scope question, a medical emergency, or an attempt to override the assistant's instructions answers `200 { reply, products: [] }` with a fixed reply. The model is not called. The exchange is saved and counts toward the session and the rate limits. The gate runs before the model and is configured through `/api/chatbot/intent-gate-credential`. With no screening key saved, or when the gate cannot classify a question, the question answers `503 assistant_unavailable` and nothing is sent to the model.

Errors are problem JSON: `401 unauthenticated` for a request without a customer identity, `400 invalid_request`, `404 chat_session_not_found` for a session that is not the customer's, `409 session_full` once the session holds 20 questions (open a new session and send again), `429 rate_limited` above 10 questions per minute or 100 per day, and `503 assistant_unavailable` when the model, the catalog, or the intent gate fails. A `400`, `404`, `409`, `429`, or `503` answer saves nothing.

## AI integration keys

A Platform Admin sets the provider, model, base URL and API key of each AI feature. Each service stores its own settings in its own database, with the key sealed. Each route therefore sits under the prefix of the service that owns the feature.

- `GET|PUT|DELETE /api/chatbot/credential` (shopping assistant)
- `GET|PUT|DELETE /api/chatbot/intent-gate-credential` (question screening)
- `GET|PUT|DELETE /api/prescriptions/intake-credential` (prescription photo reading)
- `GET|PUT|DELETE /api/products/search-credential` (semantic product search)

The shopping assistant route accepts the `gemini` and `openai-compatible` providers. `openai-compatible` calls the chat completions API at `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>` and tool calling, so its base URL carries the version path, for example `https://llm.example.com/v1`. The question screening route accepts only `typesafe`. The prescription photo route accepts only `gemini`. The product search route accepts `gemini` and `openai-compatible`; `openai-compatible` calls the embeddings API at `POST {baseUrl}/embeddings` with `Authorization: Bearer <key>`, so its base URL carries the version path (for example `https://api.openai.com/v1`), and the model must return 384-dimension vectors or accept the `dimensions` parameter. Each `GET` lists only the providers of its own route.

`GET` answers `{ providers, current }`. Each provider is `{ id, label, defaultBaseUrl }`. `current` is one of three shapes. `{ "configured": false }` means no settings are available. `{ "configured": true, "source": "stored", "provider", "model", "baseUrl", "last4", "updatedAt", "updatedBy", "environmentFallback" }` is a set of settings an admin saved, and `environmentFallback` says whether the feature's `AI_<FEATURE>_*` group would take over if they were removed. `{ "configured": true, "source": "environment", "provider", "model", "baseUrl", "last4" }` is the deployment's own settings, in use because none are saved. The key is never returned, only its last four characters.

`PUT` takes `{ "provider", "model", "baseUrl", "apiKey" }`. `baseUrl` must use https, and `apiKey` is 8 to 512 characters. `apiKey` may be omitted only when the saved settings already use the same provider, and the saved key is then kept. Otherwise the answer is `400` with code `api_key_required`. A body that fails validation gets `400 invalid_request`. `PUT` answers the same shape as `GET`. `DELETE` answers `204` and removes only the saved settings, so the environment group takes over when the server has one.

Only a Platform Admin may call these routes: `403` for any other signed-in account. A service reads its settings at most once a minute, so settings saved through one replica can take up to a minute to apply on another.

Saving the product search settings also starts a background reindex that creates embeddings for existing products. A change of model embeds them again. The `PUT` does not wait for the reindex, and it does not fail if the reindex cannot start. Until the reindex finishes, search matches keywords only. When the provider fails during a reindex (quota, timeout, a bad answer), the changed products are still indexed for keywords, and the service tries again after 30 seconds, doubling the wait up to 15 minutes, until every product has its vector.

## System overview

All routes below need a Platform Admin: `401` without a session, `403` for any other account. They are read only and answer `Cache-Control: no-store`. Errors are problem JSON `{ title, status, code }`.

`GET /api/system/overview` answers `{ generatedAt, services, load, queues, searchIndex, links }`. Each of `services`, `load`, `queues` and `searchIndex` is `{ "status": "ok", "data" }` or `{ "status": "unavailable", "error" }`, so one source being down does not fail the request. `links` is `[{ label, url }]` from the configured dashboards; the Grafana entry drives the Grafana card.

- `services[]`: `name`, `status` and `httpStatus`, `latencyMs` (from `/health/ready`), `liveStatus` and `liveHttpStatus` (from `/health/live`), `version`, `instances`, `uptimePercent24h`. The last three are `null` when Prometheus has nothing.
- `load[]`: `name`, `errorRatio` (0 to 1, 5xx over all requests in the last 5 minutes), `p95Seconds`, `outboxOldestSeconds`, `cpuCores`, `memoryBytes`, `eventLoopLagSeconds`, `dbPoolUsed`, `dbPoolMax`. Services without a database have `null` pool fields.
- `queues[]`: `name`, `ready`, `unacknowledged`, `consumers`, `deadLetter`.
- `searchIndex[]`: `name`, `documents`.

`GET /api/system/metrics/summary?windowMinutes=15|60|360|1440` answers `{ generatedAt, from, to, stepSeconds, services }`, where `services` maps each configured service to `{ availability }`: a list of `[unixSeconds, ratio | null]` points, the average of the probe gauge per step. The step is 15 s for 15 minutes and grows with the window (60 steps at most).

The step is at least 60 s.

Both metric reads answer `400 invalid_request` for an unknown service or an unsupported window, and `502 prometheus_unavailable` when Prometheus does not answer.

`GET /api/system/catalog` answers `{ services }`, one entry per probed service: `name`, `description`, `port`, `database` (the owned PostgreSQL database, or `null`), `routePrefixes` (gateway patterns; `GET /...` where the row matches one method), `dependsOn` (services it calls over HTTP), `calledBy` (services whose `dependsOn` names it), `events` (`published` and `consumed` event names). The answer is static: it changes only when ops-console-service is redeployed.

`GET /api/system/routes` answers `{ routes }`, one row per gateway path pattern: `path` (with `/api`, and a trailing `*` for a prefix), `method` (only when the row matches one method), `service`, `access` and `note`. `access.kind` is `public`, `signed-in`, `roles` (with a `roles` list), or `platform-admin`. `note` is an English sentence about an exception to that access and is optional.

## Query projections

- `GET /api/dashboard/summary`
- `GET /api/finance/summary`
- `GET /api/reports`
- `GET /api/audit/logs`
- `GET /api/dashboard/analytics`

`operations-query-service` also serves `GET /api/operations/dashboard`, `GET /api/operations/audit`, and `GET /api/operations/finance`, which answer the same data as the dashboard, audit, and finance routes above.

Dashboard routes are for Pharmacy Manager and Warehouse Staff, finance and reports for Pharmacy Manager, and audit for Platform Admin; Platform Admin reads all of them too (BR-AUTH-002). These endpoints read only `operations-query-service` projections. Projection lag is observable and does not change write-model truth.

`GET /api/audit/logs` and `GET /api/reports` answer one keyset page each. Both list newest first: audit events by `(occurredAt, eventId)`, reports by `(occurredAt, id)`. Each takes `limit` (default 100, clamped to 500) and `cursor`, and the body is the plain array of that page. When another row follows, `X-Next-Cursor` carries the cursor; send it back as `cursor` with the same other parameters. The last page has no header. A malformed or tampered cursor answers `400` with `code: "invalid_cursor"`.

`GET /api/audit/logs` also takes `q`, a case-insensitive substring over the action, the entity type, the entity id and the actor id (`%` and `_` match themselves). `siteId` narrows the audit list to one site; a site-scoped employee may name only their own sites and a request for another site answers `403`. Audit rows carry a `siteId` only when their source event names one. Order and status-change events do not, so those rows appear only when no site filter or site scope applies. `entityType`, `entityId`, `actorId` (or `userId`), `action`, `from` and `to` filter.

`GET /api/reports` takes `reportType`, matched case-insensitively against the start of the event type: `sales` lists every `sales.*` event and `payment.invoice.paid.v1` lists one type. Audit events (`*.audit.v1`) are not report rows; read them from `/api/audit/logs`. The dashboard's `recentActivity` rows carry the real `action`, `entityType`, `entityId`, `userId` and `siteId` of the latest audit entries.

`GET /api/dashboard/summary` and `GET /api/finance/summary` count from the owning services' `COUNT(*)` endpoints, never from a capped list: `totalProducts` from `GET /api/products/count`, `pendingTransferCount` from `GET /api/inventory/transfers/count?status=PendingApproval,Draft,Approved,InTransit`, `openPrescriptionCount` from `GET /api/prescriptions/count?excludeStatus=Dispensed,Cancelled`, `openStocktakeCount` from `GET /api/inventory/stocktakes/count?excludeStatus=Completed,Cancelled`, `pendingAdjustmentCount` from `GET /api/inventory/adjustments/count?status=Pending`, and `receiptCount` from `GET /api/procurement/goods-receipts/count`. A scoped reader's counts carry its site scope, and a scoped read that fails answers `5xx` rather than a fallback. A network-wide reader falls back to the projection counter only when the owning service does not answer; a reachable zero stays zero.

`GET /api/dashboard/analytics` is for Pharmacy Manager and Platform Admin only ([design 0007](design/0007-period-analytics-replenishment-and-action-plans.md), BR-REPORT-008 to 011). Query: `from` and `to` (ISO date-times, `from` inclusive, `to` exclusive, at most 366 days apart), `siteId` (optional, inside the caller's sites; another site answers `403`), `channel` (`all` default, `counter` or `online`). It answers `kpis` (`revenue`, `orderCount`, `averageOrderValue`, each `{ current, previous }` against the previous period of the same length; `grossProfit` is `{ current, previous, available, reason, coverage: { current, previous } }`: revenue less the cost of goods of the sales whose goods all have a purchase cost recorded on a goods receipt line (BR-REPORT-009), `coverage` is the share (0 to 1) of revenue that has one, and `current` is `null` with `reason: "no_cost_data"` when the period has sales but none is costed), `channels` (both channels, current period) and `inventory` (`turnover`, `daysOfInventory`, `stockoutRate` as a 0 to 1 share, `deadStock`, `stockValue` by site, `expiry` buckets). An unanswerable figure is `null`, never 0. The channel filter changes only the sales figures. The route reads `/internal/analytics/sales-documents` (sales-service), `/internal/analytics/paid-invoices` (payment-service) `/internal/analytics/dispense-costs` and `/internal/analytics/stock-health` (inventory-service); those three accept only the service secret and are not reachable through the gateway. A read that fails answers `5xx`; a period with more than 50 000 paid invoices answers `422` `analytics_range_too_large`.

Stock is valued from `GET /api/pricing/base-prices?day=` (one row per active product, its base-unit price that day, `null` when none qualifies). A stocked balance whose product has no such price is listed as `Missing price` and counted in `missingPriceCount`. `receiptQuantity` and `dispensedQuantity` are all-time quantities summed by inventory-service from the stock ledger (`GoodsReceipt` quantity in, `Dispense` quantity out), so they are not sums of prescription and receipt lines.
