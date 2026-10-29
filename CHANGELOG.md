# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Releases are cut from the `Release application images` workflow in `.github/workflows/release.yml`, which takes a `MAJOR.MINOR.PATCH` version; each version heading's date is the release date.

## [Unreleased]

### Added

**staff-web, operations-query-service, sales-service, payment-service, inventory-service**

- Action plans are created by the system: at boot and every 15 minutes `inventory-service` raises a plan for each replenishment suggestion, expiring or expired batch, dead stock line and unpriced product that has no live plan, and assigns it to the active Pharmacist at the site with the fewest open or in-progress plans (ties by name), or to the site's Pharmacy Manager when the site has no Pharmacist. Due in 7 days; a plan done in the last 7 days is not recreated. `GET /internal/employees?siteId` is new on `identity-service` (service secret only). **Tạo kế hoạch** stays as a manager override. Choosing a plan's title opens a read-only drawer with the description, the next step and a link to the page of the work. A manager only reassigns a plan (**Giao lại**, owner field only); the status is the owner's and the title, detail and due date are the system's, in the UI and in the `PATCH` route. BR-PLAN-001 and design 0007 updated.
- Analytics page (`/analytics`, Platform Admin and Pharmacy Manager): revenue, order count and average order value against the previous period, filtered by period, site and channel (counter or online), plus inventory health (turnover, dead stock, stockout rate, stock value by site, expiry buckets). Gross profit is revenue less purchase cost for the sales whose goods all have a recorded cost, with the share of revenue it covers; it shows "—" when none does. New `GET /api/dashboard/analytics`, fed by read-only `/internal/analytics/*` routes (service secret only); `operations-query-service` now requires `PAYMENT_SERVICE_URL`. See `docs/design/0007-period-analytics-replenishment-and-action-plans.md` and BR-REPORT-008 to 011.
- Purchase cost on goods receipt lines: optional **Giá nhập** per line (VND per unit, before VAT), migration `0014_receipt_line_unit_cost` (nullable, no backfill), `unitCost` on `POST /api/procurement/goods-receipts` and in every receipt answer; new service-only `GET /internal/analytics/dispense-costs` feeds gross profit. BR-PROC-009, BR-REPORT-009.
- Action plans page shows a clear Vietnamese message to an employee with no assigned site instead of a blank list.
- Reorder suggestions (Procurement tab "Gợi ý đặt hàng", Platform Admin and Pharmacy Manager): per site, suggested quantities per product and supplier from sales velocity, stock, the minimum stock threshold and observed supplier lead time, and one **draft** purchase order per supplier created in bulk in one transaction. Nothing is submitted or approved. New `GET /api/procurement/replenishment-suggestions` and `POST /api/procurement/replenishment-suggestions/draft-orders`; BR-PROC-007, BR-PROC-008.
- Action plans (`/action-plans`): a plan item with owner, due date and status (open, in progress, done) created from a reorder suggestion, a dead stock row, an expiring batch or a missing price, listed in one view filtered by owner and status. New `inventory-service` table `action_plans` (migration `0013`), routes `/api/inventory/action-plans`, and `GET /api/auth/staff-directory` for the owner picker. `inventory-service` now requires `IDENTITY_SERVICE_URL`. BR-PLAN-001, BR-PLAN-002.

**customer-web**

- Saved addresses added and edited in a map dialog, with maps rendered by the Vietmap SDK.
- Product detail pages, a grouped category menu and category pages.
- Prescription intake page with a zoomable full-screen photo viewer; differing suggestions are flagged and shoppers can ask a pharmacist.
- Checkout completes on a shared cart cache with a live invoice, and shoppers' orders have their own page.
- Account page wired to the profile, prescription and address endpoints.
- Cart lines are ticked before ordering (new lines start unticked): the order summary, total and **Đặt hàng** cover only the ticked lines, and the unticked ones stay in the cart. **Mua ngay** on a product page ticks the line it adds.
- Product specs under `docs/product/`: one per customer-web page and per staff-web section group (22 in all), written from the code. Each states the target behavior, answers its questions under Decisions from industry practice, and lists the differences from the code under Gaps.
- Scrolling inside the shopping assistant panel no longer scrolls the page behind it.
- Searching on Home hides the hero banner and the quick actions, so the results start at the top.
- Prescription-only products show "Cần đơn thuốc" or a **Gửi đơn thuốc** link instead of add-to-cart and buy buttons, and a signed-out shopper cannot add them either.
- A signed-out cart is kept in the browser (`localStorage`) and moves into the account at sign-in; opening a page no longer creates a cart on the server.

**sales-service**

- `POST /api/orders` accepts `fromCart: true` instead of `lines`: the server orders the caller's ticked cart lines and removes them once the stock is held. New error `409 cart_selection_empty`.
- Cart lines carry a server-kept `selected` flag (migration `0012_cart_line_selected`), set through the new `PATCH /api/carts/selection`.
- `POST /api/carts/merge` takes the browser cart in its body (`{ lines: [...] }`).
- Staff permissions follow the role contract in `docs/product/staff-shell-sign-in-and-navigation.md`: roles are checked at the edge and again in each service, a record at another site is refused before any write, and nobody approves a record they created (`403 self_approval_forbidden`). Platform Admin proposes but never approves search synonym groups, and does not take cash at the counter. Staff can deactivate and reactivate employee accounts; a reset forces a password change (`password_change_required`); staff sign-in refuses customer accounts (`audience: "employee"`). Staff order lists show the customer name and phone to Pharmacist, Pharmacy Manager and Platform Admin. `/api/sites`, suppliers, storage locations and non-published prices are no longer public.
- Prescription-only products (`prescriptionRequired`) are refused with `409 prescription_required` by `POST /api/carts/lines` and `POST /api/orders` (both `lines` and `fromCart`); a cart merge drops them. A catalog read failure answers 500. See ADR 0016.

**staff-web**

- System page with a service catalog, route table and tabs for what Grafana cannot show.
- Actions gated by role.
- Online orders screen, issuing a prescription to a customer account, answering consultations and looking up customers at the counter.
- Staff screens for CSV data import, AI integrations and search synonyms.

**identity-service**

- Counter lookup and verification of customer accounts, plus customer phone numbers and profile editing.
- Employee and admin actions audited through an outbox.

**catalog-service**

- Product master data and product image import.
- Hybrid product search with staff-managed synonyms and stored AI settings.
- Cursor and keyset paging, `q` search, counts, base prices, a response cache and self-hosted embeddings for search.
- Prescription lines matched to catalog products, weighing dosage form and composition.

**search-service**

- Go read path for `GET /api/products`, with the search-service and a self-hosted embedder added to Compose and AWS.

**inventory-service**

- Opening stock balance import, and keyset paging, search and counts for procurement and stock lists.
- Finance valuation at published prices and reconciliation from the ledger.

**sales-service**

- Printed prescriptions read from a QR code or a photo.
- Delivery priced with a free zone, base fee and 10 km radius; addresses searched and reverse-geocoded via Vietmap.
- Stock held for online orders until handover; prescriptions owned per customer, with a default delivery address.
- Staff order list and confirmation when payment lands; keyset paging and search for orders, prescriptions and consultations.

**payment-service**

- Paged invoice list with status and search.

**operations-query-service**

- Paged audit log and reports, with the acting user carried through audit events.

**chatbot-service**

- Shopping assistant with tool calling, an intent gate and a widget, deployed with Redis and Typesense in the local and AWS stacks.

**ops-console-service**

- Read-only System backend for Platform Admins, with `/api/system` routed to ops-console-service.

**platform/tooling/docs**

- Repository documentation standard: CONTRIBUTING.md, SECURITY.md, LICENSE, CODEOWNERS, CLAUDE.md, CHANGELOG.md, docs/architecture.md, docs/adr, docs/design, GitHub PR and issue templates.
- Thirteen ADRs (docs/adr) recording existing decisions, and three draft design documents (docs/design): operations-query events-only reads, fail-fast configuration gaps, and guest cart cookie and edge header hardening.
- AGENTS.md Change workflow: ask which local mode to use (dev mode or container mode) at the start of a session, then one loop for orienting, building, gating, running in Docker, verifying and documenting a change.
- `verify-pharmacy-central` and `maintain-verification-skill` moved to `.agents/skills` and tracked in git; the verify skill now supports dev mode and container mode, drives the default browser tool on the named URLs with saved role state files, and no longer launches Edge.
- Original .NET pharmacy application: products, suppliers, stock ledger, goods receipt, transfers, stocktake, prescriptions, returns, procurement, pricing, recall, quality review, reconciliation, audit log and role-based access.
- Node.js microservice foundation: pnpm and Nx workspace, shared UI package, identity, catalog, inventory, sales, payment and operations-query services, customer and staff web apps, local Compose topology, API gateway and AWS Fargate configuration.
- OTLP export of traces, metrics and logs from every service, with a local Tempo, Prometheus, Loki and Grafana stack, trace context carried through the outbox, and a derived service map.
- Business metrics, alerts and dashboards for outbox, consumers, webhooks, chatbot, delivery and RabbitMQ; process saturation, build version and correlation IDs; AWS OpenTelemetry collector and AMP workspace.
- k6 load scenarios, a mock AI server, a bulk product generator and a chaos fault-injection runner.
- `dev:data` loader, product image folder and sample orders in every state, with demo accounts seeded only through it.
- Shared UI: sortable virtualized tables, DataTable v2, toasts, focus-trapped dialogs, status primitives and segmented tabs with a popover.
- LikeC4 architecture model.
- AWS staging deployment (`deploy/aws`): VPC with NAT, RDS, ElastiCache, S3 media, ECR with immutable tags, API Gateway with the edge authorizer, one HTTPS web ALB with `shop.` and `staff.` host rules, and RabbitMQ and Typesense tasks, with `tools/aws-env.mjs`, `tools/aws-push-images.mjs` and `tools/aws-upload-media.mjs`. Design: `docs/design/0006-aws-demo-deployment.md`.

### Changed

**customer-web**

- customer-web: blue brand header, tinted page background and stronger checkout hierarchy
- customer-web: Home hero uses a deep navy palette distinct from the header, the category bar shows on every storefront page, and Home no longer overflows horizontally at 360px.
- One `/don-hang` page with Đặt hàng and Đơn của tôi tabs.
- Order and checkout pages rebuilt around one featured order and a storefront checkout.
- Homepage hero with a generated banner image, account page with a sidebar and real sections, and storefront migrated to the TanStack stack.

**staff-web**

- Buttons the signed-in role may not use are hidden instead of dimmed, as in Odoo. The service and the edge still refuse the call.
- Back-office UX overhaul with drawer forms, a grouped audit log and calmer row actions; workspace modernized and migrated to the TanStack stack.
- Receiving, Inventory and Prescriptions tabs replaced by drawers: the old Create order, Receive goods, Create batch, Create transfer, Count line, Create and Dispense tabs are gone, and links with those `?tab=` values open the list.

**catalog-service**

- Successful writes are audited and business-rule violations return 409 Conflict.

**inventory-service**

- Successful writes are audited and business-rule violations return 409 Conflict.
- Dispense real stock and count only sellable batches.
- Transfers and goods receipts are listed newest first; `receiptQuantity` and `dispensedQuantity` are summed from the stock ledger instead of from prescription and receipt lines.

**sales-service**

- Online orders for unpriced products are blocked at checkout.
- Prescription model read from stored AI settings; caches moved to Redis.
- A shopper's first address becomes the default, and a survivor is promoted when the default is deleted.

**operations-query-service**

- Dashboard counts come from the owning services.

**platform/tooling/docs**

- Local object storage moved from SeaweedFS to Floci (`floci/floci:latest`, port 4566), a local AWS emulator that also serves ECR. The `seaweedfs` and `seaweedfs-init` Compose services became `floci` and `floci-init`. catalog-service now reads the standard AWS variables `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` plus `MEDIA_BUCKET` and `PUBLIC_MEDIA_URL`, instead of `SEAWEEDFS_*`; `deploy/aws` passes the same names to ECS. The image URLs in `data/import-samples/products.csv` moved from port 9000 to 4566. `tools/aws-upload-media.mjs` no longer takes `--env-file=.env` and refuses to run with an emulator endpoint set.
- Two separate seeds replace `pnpm run dev:data`. `pnpm run seed:default` creates exactly one account, the Platform Admin, with `ADMIN_PASSWORD`, and nothing else. `pnpm run seed:demo` is the opt-in demo and reference dataset (images, sites, demo accounts, warehouses, suppliers, products with units, opening balances, synonyms, demo activity); it runs after the first and creates the sites before the accounts. `ADMIN_PASSWORD` is a new required variable, and the AWS ops task, k6 and chaos tools sign in as the admin with it. ADR 0018.
- docs/Runbooks.md renamed to docs/runbook.md
- Outbox publishes rows in batches, deletes old published rows, and indexes unpublished rows and line-table foreign keys.
- CI validation split from on-demand image releases.
- Local development runs every app on the host through Nx with a dev gateway, named portless URLs and separate ports for the web apps.
- Documentation updated for prescriptions, procurement, cache policy, paging conventions, the System page and alert runbooks.
- docs/UserGuide.md, docs/ApiGuide.md and docs/BusinessRules.md renamed to docs/user-guide.md, docs/api-guide.md and docs/business-rules.md and cleaned up: named URLs, a broken table fixed, history notes moved here, and "Giới hạn đã biết" moved to the end of BusinessRules.
- Service and `ops` images use an Alpine runtime with only the Node binary, and `drizzle-kit` is a dev dependency, so they no longer ship it. Backend images shrink from 430-470 MB to 240-290 MB.
- AWS staging cost: RabbitMQ runs as a Fargate task instead of Amazon MQ, one public ALB serves both web apps, RDS is `db.t4g.micro`, secrets are SSM parameters, and autoscaling and Container Insights are gone. The design lists about 505 USD a month before and about 235 after.
- AWS staging DNS is Terraform too: the Cloudflare provider creates the ACM validation records and the `shop.` and `staff.` CNAMEs in the same apply, and a destroy removes them. It needs `cloudflare_zone_id` and `CLOUDFLARE_API_TOKEN`; the `certificate_validation_records` and `site_cnames` outputs are gone.

### Removed

**customer-web**

- The `/don-hang-cua-toi` address; orders live under `/don-hang?tab=don-cua-toi`.

**sales-service**

- The server-side guest cart: the `pharmacy_guest_cart` cookie, the guest rows and `guest_token_digest` column (migration `0013`), public access to `/api/carts*`, and the `COOKIE_SECURE` requirement. Every `/api/carts*` route now needs a signed-in customer.

**platform/tooling/docs**

- Legacy .NET solution and legacy frontend removed.
- Jira sync tool removed.
- Demo seed scripts retired; local accounts are seeded only through `dev:data`.
- Documentation trimmed to the essentials and matched to the code.

### Fixed

**customer-web**

- Order and prescription status wording made consistent.
- A notice is shown instead of a crash when WebGL is unavailable.
- Address search button aligned, and shoppers can clear the search.
- Cart written into one cache; the orders page cache is kept apart from the account page.
- Maps render and the nearest store is found (with catalog-service).

**sales-service**

- Cart creation and pricing hardened.
- Creating or editing a purchase order no longer fails with 500 behind the signed gateway: inventory-service read the supplier, site and product from the catalog with only the service secret, which the catalog refuses on staff routes. It now sends the signed identity of the employee who writes.
- A delivery estimate or a delivery order no longer answers `404 store_not_found`: the store is read from the public `GET /stores/:id` of catalog-service, not from the staff-only `/sites/:id` with a service secret.

**catalog-service**

- Global product pricing enforced.
- `GET /stores/:id` answers one active, customer-facing store (code, name, address, coordinates) with no sign-in.

**payment-service**

- Shopper invoices include the delivery fee; SePay's timestamped signatures and loose codes are accepted.

**platform/tooling/docs**

- Event delivery made durable and recoverable.
- Telemetry from sources other than this system's services is dropped.
- Edge authorizer: the signed identity context keeps the services' schema key order, so catalog, inventory and the other services accept it instead of answering 401, and the Lambda entrypoint no longer re-exports removed policy names.
- Dashboard and finance summary: operations-query-service reads the catalog's sites, storage locations and suppliers as the employee who asked, so the totals are no longer 0 for Platform Admin and a Pharmacy Manager no longer gets a 500 (the catalog answered its staff-only lists 401 to the service secret).
- Opening balance import: inventory-service signs the importing employee's identity for catalog-service, so the catalog applies its role and site rules to each lookup. The lookups carried no identity and the import ended in a 409 "status 401 for /sites".
- Deploy fixes for chatbot migrations, the ops-console migration task and cache headers, and for customer prescription routes on AWS.
- Express service template requires `PORT`.
- Shared UI: table toolbar, header casing, quiet row delete, readable site types, StatTile edge, honest warning tone and grouped dashboard KPIs.

### Security

**platform/tooling/docs**

- Guest cart cookie is `HttpOnly` with `Secure` driven by the new required `COOKIE_SECURE` variable (sales-service, identity-service, CSRF Lambda); the old `X-Guest-Cart-Token` header is gone and the cookie is cleared after the merge into an account.
- Services drop client-supplied `x-actor-id` and `x-actor-type` when no identity context or service secret is verified, both local gateways strip them, anonymous callers get actor type `anonymous` instead of `system`, and the SePay webhook path strips identity headers (design 0003).

**customer-web**

- A staff session never lists other shoppers' orders.

**identity-service**

- Credential endpoints are rate limited.

**sales-service**

- Staff reads are scoped to their sites, and service settings are required.

**inventory-service**

- Inventory, procurement, storage-location and availability reads are scoped to the caller's sites.

**operations-query-service**

- A site-scoped dashboard is limited to the reader's sites.

**payment-service**

- Service URLs and the internal secret are required; shopper invoices are priced from the order, not the request.

**platform/tooling/docs**

- Dependency audit advisories fixed.
- Each service has its own Postgres role.
- Authorizer aligned with counter roles and customer routes.
- Legacy .NET application enforces API role policies and assigned site boundaries.

[Unreleased]: https://github.com/nielpattin/PharmacyCentral/commits/main
