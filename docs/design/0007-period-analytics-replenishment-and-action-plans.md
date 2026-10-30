# 0007. Period analytics, replenishment suggestions and action plans

- **Status:** Implemented on the owner's instruction; review still welcome
- **Author:** @nielpattin
- **Date:** 2026-10-28

## Summary

Three staff-web features for Pharmacy Managers and Platform Admin. (1) An **Analytics** page with period KPIs (revenue, orders, average order value, gross profit, each against the previous period) filtered by site and channel, and inventory health (turnover, dead stock, stockout rate, stock value by site, expiry buckets). (2) **Replenishment suggestions** on the Procurement page: suggested order quantities per product and supplier from sales velocity, stock, minimum stock and supplier lead time, reviewed by the user and turned into one **draft** purchase order per supplier. (3) **Action plans**: a plan item (owner, due date, open / in progress / done) that the system creates for every suggestion or alert and assigns to an owner by rule, with one list filtered by owner and status; a manager can still create one by hand and change the owner, due date and title.

Services touched: `operations-query-service` (aggregation, read only), `sales-service` and `payment-service` (one internal read each), `inventory-service` (one internal read, the suggestion routes, the action plan module and its table), `identity-service` (one read-only staff directory route), `staff-web`, and the edge policy.

## Motivation

The dashboard shows counts only ([staff dashboard spec](../product/staff-dashboard-and-reporting.md), "No charts" and "Financial values ... see Finance"). Managers have no period view of takings, no stock turnover figure, no list of what to reorder, and nowhere to record who will act on an alert. Reordering is done by eye from the low-stock tile.

## Goals

- A manager answers "how did we sell and how healthy is stock over this period, at this site, in this channel" from one page, with the previous period beside every KPI.
- A manager gets a reviewable reorder list and creates drafts in bulk through the existing procurement flow. Nothing is submitted or approved automatically.
- Any alert or suggestion becomes an owned, dated plan item, created by the system with no click, that its owner can move to done.

## Non-goals

- No new write path for analytics. Analytics routes only read.
- No supplier lead time field and no per-product minimum stock field (see Open questions: minimum stock, lead time). Nothing is guessed to fill them. The purchase cost is recorded on goods receipt lines (see "Purchase cost and gross profit"); a sale whose goods have no recorded cost has no gross profit.
- No auto-submit, auto-approve or auto-receive of a purchase order.
- No integration events and no change to existing events. No cross-service table change. The only change to an existing table is one nullable column on `goods_receipt_lines`.
- No charts library. Figures use `StatTile` and tables.

## Proposed design

### Contracts

All new service-to-service reads live under `/internal/...`, which neither the local gateway (`routes.conf`) nor the ALB forwards, so a browser can never reach them. They require the service secret (`internalServiceHeaders()`); site scope travels in `x-actor-site-ids` as every existing read of `operations-query-service` does. The path routing map is unchanged: the browser routes below use the prefixes that already exist.

Browser routes (all behind the edge role rules and the service role check):

| Route | Service | Roles | Purpose |
| --- | --- | --- | --- |
| `GET /api/dashboard/analytics` | operations-query | Platform Admin, Pharmacy Manager | Period KPIs and inventory health |
| `GET /api/procurement/replenishment-suggestions` | inventory | Platform Admin, Pharmacy Manager | Suggestion list for one site |
| `POST /api/procurement/replenishment-suggestions/draft-orders` | inventory | Pharmacy Manager | One Draft purchase order per supplier |
| `GET /api/inventory/action-plans` | inventory | any employee (a manager all of their sites, Platform Admin all, others own) | Plan list |
| `POST /api/inventory/action-plans` | inventory | Pharmacy Manager | Create a plan item |
| `PATCH /api/inventory/action-plans/:id` | inventory | owner (status only), manager or Platform Admin (`ownerId` only) | Move the status, or reassign the owner |
| `GET /api/auth/staff-directory` | identity | Platform Admin, Pharmacy Manager | Employee names for the owner picker |

Internal routes (ops-query to owner services):

| Route | Service | Answer |
| --- | --- | --- |
| `GET /internal/analytics/sales-documents?from&to` | sales | `{ documents: [{ id, kind: "order" \| "prescription", siteId, createdAt }] }` created in `[from, to)`. `kind: "order"` is an online order (`siteId` = `selectedStoreId`), `"prescription"` is a counter sale. Site-scoped by header. |
| `GET /internal/analytics/paid-invoices?since` | payment | `{ invoices: [{ orderId \| null, prescriptionId \| null, amount, createdAt }] }` for invoices with status `Paid` created at or after `since`. Hard cap 50 000 rows; more answers 422 `analytics_range_too_large`. |
| `GET /internal/analytics/stock-health?from&to` | inventory | `{ from, to, asOf, deadStockDays: 90, rows: [{ siteId, productId, onHand, reserved, dispensed, netChange, lastMovementAt, expired, expiring30, expiring60, expiring90 }] }`, one row per (site, product) that has a balance row or a ledger entry; quantities are base units. Site-scoped by header. |
| `GET /internal/analytics/dispense-costs?since` | inventory | `{ since, rows: [{ referenceType: "Order" \| "Prescription", referenceId, quantity, costedQuantity, cost }] }`: for each sale with a `Dispense` ledger entry at or after `since`, the base units handed over, the part taken from batches whose receipts recorded a cost, and the cost of that part in VND. Not site-scoped (the document that it joins to is). More than 50 000 rows answers 422 `analytics_range_too_large`. |

#### `GET /api/dashboard/analytics`

Query: `from`, `to` (ISO date-time, `from` inclusive, `to` exclusive, at most 366 days apart), `siteId` (optional, inside the caller's scope), `channel` (`all` default, `counter`, `online`).

The previous period is the same length ending at `from`. Answer:

```
{
  currency: "VND", generatedAt,
  period: { from, to }, previousPeriod: { from, to },
  siteId: string | null, channel: "all" | "counter" | "online",
  kpis: {
    revenue: { current, previous },
    orderCount: { current, previous },
    averageOrderValue: { current: number | null, previous: number | null },
    grossProfit: {
      current: number | null, previous: number | null, available: boolean, reason: "no_cost_data" | null,
      coverage: { current: number | null, previous: number | null }   // share (0 to 1) of revenue that has a cost
    }
  },
  channels: [{ channel: "counter" | "online", revenue, orderCount }],   // current period, site filter applied, channel filter ignored
  inventory: {
    turnover: number | null, daysOfInventory: number | null,
    stockoutRate: number | null, stockedProductCount, outOfStockProductCount,
    deadStock: { deadStockDays, productCount, quantity, value, items: [{ siteId, productId, productName, quantity, value }] },
    stockValue: { total, missingPriceCount, bySite: [{ siteId, siteName, quantity, value }] },
    expiry: { expired, within30, within60, within90 }   // each { productCount, quantity, value }
  }
}
```

A figure that cannot be answered is `null`, never 0 (reporting spec decision 4).

#### Purchase cost and gross profit

Gross profit needs what the goods cost. `goods_receipt_lines.unit_cost numeric(18,2) NULL` (migration `0014_receipt_line_unit_cost`, with `CHECK (unit_cost IS NULL OR unit_cost >= 0)`) holds the purchase cost in VND per base unit received, before VAT. `POST /api/procurement/goods-receipts` accepts an optional `unitCost` per line (number from 0, at most 2 decimals, at most 1 000 000 000); every receipt answer returns it as `unitCost: number | null`. No backfill: lines that exist stay `NULL`, which means unknown and is never read as 0.

The unit cost of a batch is the mean of `unit_cost` over the goods receipt lines with the same product and batch number and a non-null cost, weighted by line quantity, so a batch received twice at two costs is priced by its mix and a line without cost never drags the mean down. A `Dispense` ledger entry whose batch has no such line is uncosted. Batches created by an opening balance import have no receipt line, so their sales are uncosted until a receipt names a cost. The staff-web receipt form has an optional "Giá nhập (₫/đơn vị)" field per line, validated client side (no negatives, at most 2 decimals, a comma is refused) and again by the contract and the database.

Definitions (also BR-REPORT-008 to 011):

- **Sale:** an online order or a counter prescription that has a `Paid` payment invoice. Revenue is the sum of those invoice amounts; a refunded invoice is not `Paid`, so it is not revenue. A sale belongs to the period of its document's `createdAt` (order or prescription), in the site of the document. Order count is the number of sales; average order value is revenue / order count, `null` when the count is 0.
- **Join:** operations-query reads sales documents for `[previous.from, to)` from sales-service and `Paid` invoices created since `previous.from` from payment-service, and joins them on `orderId` / `prescriptionId`. An invoice is always created after its document, so a document created in the period has its invoice inside the invoice read.
- **Turnover:** units dispensed in the period / average stock in units, where average stock = (opening + closing) / 2, closing is on hand now and opening is closing minus the net ledger change in the period. `null` when the average is 0. Days of inventory = period days / turnover.
- **Dead stock:** on-hand stock of a product at a site whose last ledger movement is older than 90 days (or that has none). Value at today's published price.
- **Stockout rate:** among the (site, product) pairs that have a balance row or a ledger entry, the share whose available quantity (on hand minus reserved) is 0 or less now. Point in time: the system keeps no daily stock snapshots, so this is not a rate over the period.
- **Stock value:** on hand times today's published base-unit selling price (`GET /pricing/base-prices`), the same valuation as the Finance summary. A product with no published price adds nothing and is counted in `missingPriceCount`.
- **Expiry buckets:** on-hand quantity of batches that expire already (`expired`), in 0 to 30 days (`within30`), 31 to 60 (`within60`) and 61 to 90 days (`within90`) from today.
- **Gross profit:** revenue less cost of goods, over the sales whose goods are all costed. A sale is *costed* when its dispense row exists, `quantity > 0` and `costedQuantity = quantity`. A partly costed or uncosted sale adds neither its revenue nor a guessed cost. `coverage` is the revenue of costed sales over the revenue of all sales of the period. With sales but none costed, gross profit is `null` (`reason: "no_cost_data"`); with no sale at all it is a true 0 and `coverage` is `null` (BR-REPORT-009).
- **Channel** filters the sales KPIs only. Stock belongs to a site, not to a channel, so inventory health ignores it, and the page says so.

#### `GET /api/procurement/replenishment-suggestions`

Query: `siteId` (required, inside scope), `windowDays` (default 30, 7 to 180), `coverDays` (default 14, 1 to 90), `safetyDays` (default 7, 0 to 60), `defaultLeadTimeDays` (default 7, 1 to 90). Defaults are request parameters shown in the UI, not environment variables.

Per product at the site:

- `dailyVelocity` = base units with a `Dispense` ledger entry in the window / `windowDays`. Online orders and counter dispenses both write `Dispense`, so one ledger gives both channels.
- `available` = on hand − reserved at the site; `inboundQuantity` = ordered − received of purchase orders at the site in `Draft`, `Approved` or part received (so a draft already created is not suggested again).
- `minimumStock` = 10 base units, the low-stock threshold of [BR-REPORT-002](../business-rules.md), raised to `dailyVelocity × safetyDays` when that is larger.
- `leadTimeDays` = median days from purchase order creation to its first goods receipt for the product's supplier over the last 12 months (`leadTimeSource: "history"`, with `sampleCount`); with no history, `defaultLeadTimeDays` (`"default"`).
- `supplierId` = supplier of the product's latest goods receipt at the site, else at any site, else `null` (the row cannot be drafted until the user picks one).
- `reorderPoint` = `dailyVelocity × leadTimeDays + minimumStock`; `targetStock` = `dailyVelocity × (leadTimeDays + coverDays) + minimumStock`.
- A product is suggested when `available + inboundQuantity ≤ reorderPoint` and the product moved in the window or sits below `minimumStock`. `suggestedQuantity` = `ceil(targetStock − available − inboundQuantity)`, at least 1.

Answer: `{ siteId, params, generatedAt, suggestions: [{ productId, supplierId, dailyVelocity, dispensedQuantity, onHand, reserved, available, inboundQuantity, minimumStock, leadTimeDays, leadTimeSource, sampleCount, reorderPoint, targetStock, suggestedQuantity, daysOfCover }] }`. Product and supplier names are resolved by the page from the catalog.

#### `POST /api/procurement/replenishment-suggestions/draft-orders`

Body: `{ siteId, orders: [{ supplierId, lines: [{ productId, orderedQuantity: integer ≥ 1 }], notes? }] }`; one entry per supplier (a repeated supplier is 400). The route reuses the purchase order creation of the procurement flow (`ProcurementRepository.createPurchaseOrder`, the same catalog reference checks), in one transaction, so every order is created or none. The orders are `Draft`; the existing approve and cancel actions (approver is never the creator) are untouched. Answer 201 `{ purchaseOrders: [...] }`. The audit trail records the creation as it does for the existing route.

#### Action plans

`action_plans` in `inventory-service` (see Data model). `GET /api/inventory/action-plans` query: `ownerId`, `status` (`open`, `in_progress`, `done`), `sourceType`, `siteId`, `q`, `limit`, `cursor`; a keyset page newest first like the other lists. A Pharmacy Manager or Platform Admin sees every plan in their sites (plans with no site are visible to Platform Admin only); any other employee sees only plans they own. `POST` body: `{ sourceType, sourceRef, title, detail?, siteId?, productId?, ownerId, dueDate }`. `PATCH` body: any of `{ status, ownerId, dueDate, title, detail }`; the owner may change `status` only; a manager changes anything. Moving to `done` sets `completedAt`; moving back clears it. The owner must be an active employee whose sites include the plan's site (checked through identity-service); an unknown owner is 422 `owner_not_found`.

#### Automatic plans (owner decision 2026-10-29)

Nobody has to ask for a plan. `ActionPlanAutoCreator` in `inventory-service` runs at boot and every 15 minutes (`ActionPlanAutoSweeper`, the pattern of the expiry sweeper). It is a server loop with no route, so it cannot be triggered or skipped from a browser. One run:

1. Reads the alerts from the live data: **replenishment** from the suggestion formulas with the default parameters at every site that has stock or movements; **expiry** from batches with stock on hand that expire within 30 days or have expired (`expiringBatches`); **dead stock** from stock health, stock on hand with no movement for 90 days; **price warning** from the catalog's `GET /pricing/base-prices` (a listed product with no price) joined to stock on hand, filed at the site that holds the most of it. Titles and details are the ones the manual drawer fills; the `sourceRef` keys are the same, so a manual and an automatic plan collide on the live-source index.
2. Drops the alerts that have a live plan, or a plan completed in the last 7 days (so a finished plan is not replaced at the next run while its alert persists).
3. For each remaining alert, lists the active employees at its site (`GET /internal/employees?siteId`, identity-service, service secret only) and picks the owner: the **Pharmacist with the fewest `open` or `in_progress` plans**, ties by name in Vietnamese alphabetical order, then id. Each plan created in the run counts toward its owner at once. A site with no Pharmacist falls back to its active **Pharmacy Manager** by the same rule. A site with neither gets no plan and a warning in the log; the next run tries again. No owner is guessed.
4. Inserts the plan: `status open`, `due_date` = today (UTC) + 7 days, `created_by` = the nil UUID `00000000-0000-0000-0000-000000000000` (a system creator, not an account), and writes the audit entry `inventory.action-plan.created` with `automatic: true` and no actor.

Idempotence rests on the partial unique index: a second or concurrent run that meets a live plan treats the conflict as done and creates nothing. A run whose source is unavailable (identity-service, catalog) fails whole and is retried at the next tick; plans already created stay.

A Pharmacy Manager or Platform Admin can still create a plan by hand (the four **Tạo kế hoạch** entry points stay as an override for an alert the run skipped) and reassign the owner of any plan of their sites. A manager changes nothing else (owner decision 2026-10-29): the title, detail and due date come from the system, and only the owner moves the status. The service refuses a manager the other fields, and an owner anything but the status. A Pharmacist never creates a plan; the edge and the service refuse `POST`.

`sourceType`: `replenishment`, `expiry`, `dead_stock`, `price_warning`. `sourceRef` is a stable text key of the origin (for example `replenishment:<siteId>:<productId>`), unique among open or in progress plans of the same type so the same alert does not get two live plans (409 `plan_exists`).

#### `GET /api/auth/staff-directory`

Read only. Platform Admin gets every active employee; a Pharmacy Manager gets the active employees who share at least one site with them. Fields: `id`, `displayName`, `roles`, `siteIds`; never email. Other callers get 403, and so does an account that must still change its password. `inventory-service` checks an owner through the service-only `GET /internal/employees/{id}` of identity-service (`IDENTITY_SERVICE_URL`), which answers an active employee or 404, and finds the automatic owner through the service-only `GET /internal/employees?siteId={id}`, which answers `{ employees: [{ id, displayName, roles, siteIds }] }` for the active employees at that site (never an email; the caller filters by role). A valid owner who does not hold the plan's site answers 422 `owner_not_at_site`.

An employee with no assigned site (and not Platform Admin) is refused by the edge and by the service on every site-scoped list, the plan list included. The action plans page reads that as its own state and shows "Tài khoản của bạn chưa được gán cơ sở nào…" without sending the request; a 403 from the list shows the same sentence.

### Data model

`inventory-service`, migration `0013_action_plans.sql`:

`action_plans(id uuid pk, source_type varchar(30), source_ref varchar(200), title varchar(300), detail text, site_id uuid null, product_id uuid null, owner_id uuid, due_date date, status varchar(20) default 'open', created_by uuid, created_at, updated_at, completed_at null)`; indexes `(created_at desc, id desc)`, `(owner_id, status)`, and a partial unique index on `(source_type, source_ref)` where `status <> 'done'`.

One nullable column is added to `goods_receipt_lines` (see "Purchase cost and gross profit"). No other table changes.

### Events

None. Plans are not published; operations-query keeps reading its own projections and the HTTP reads it already uses.

### Security and CSRF

- Every browser route re-checks its role in the service (ADR 0017) and has a rule in `deploy/aws/lambda/policy.mjs`. The new site-scoped prefixes are added to the site scope lists of the edge and of each service's `trusted-request.ts`.
- Mutations (`POST`, `PATCH`) are browser mutations, so they need the CSRF token like every other write.
- Internal routes accept only the service secret and refuse any caller that carries an employee identity.
- The staff directory returns names and roles only, to the two roles that assign owners.
- Client input is never authoritative: the suggestion quantities shown are server computed, and the draft route recomputes nothing but validates every reference and that each line is a positive integer; stock, price and identity are not taken from the client.

### Observability

The new routes inherit the services' request tracing and metrics. No new metric.

## Alternatives considered

- **Project the sales figures from events.** The paid and order events carry neither the site nor the channel, so this needs new event fields and a backfill. Rejected for this change; revisit with design 0001.
- **Add `site_id` to payment invoices.** A cross-service schema and write-path change for a read feature. Rejected.
- **Put action plans in operations-query.** It owns read models only (ADR 0003). Rejected; inventory already owns replenishment, expiry and quality.
- **Estimate gross profit from a margin percentage.** That is a guessed value, which BR-FIN-002 and BR-FIN-003 forbid. Rejected.

## Rollout and migration

1. Deploy `inventory-service` (migrations `0013` and `0014`), `sales-service`, `payment-service`, `identity-service`; the new routes are additive.
2. Deploy `operations-query-service` (it calls the four internal reads: sales documents, paid invoices, dispense costs and stock health), then the edge policy, then `staff-web`.
3. Run `pnpm run db:migrate`. Rollback: drop `action_plans` and the column `goods_receipt_lines.unit_cost`; no other data changes.

## Testing

Unit tests for the pure computations (velocity, lead time, reorder quantity, turnover, buckets, join), route tests for role, scope and validation of every new route, and a browser pass over each screen at 1920x1080.

## Open questions

- **Gross profit coverage.** Gross profit is only as complete as the costs entered. Opening balances carry no cost and old receipts stay unknown, so the page shows the share of revenue it covers. Owner decision: backfill costs for the opening stock, or require a cost on every new receipt line (today it is optional).
- **Cost method.** The quantity-weighted mean per batch is a simple, explainable choice; FIFO or moving average per product would need a cost on the stock balance. Revisit if the owner wants stock valued at cost.
- **Minimum stock and lead time.** There is no per-product minimum stock or supplier lead time field. This design uses the BR-REPORT-002 threshold, a safety-days parameter and the observed lead time of receipts. Owner decision: store a minimum stock per product and site, and a lead time per supplier.
- **Automatic plan rules.** The 15-minute cadence, the 7-day due date and the 7-day cooldown after a plan is done are decisions of this change, not measured values. The fallback owner is the site's Pharmacy Manager. Owner decision: change any of them.
- **Product to supplier.** The catalog has no preferred supplier per product; the latest goods receipt supplier is used. Owner decision: a preferred supplier per product.

## Related ADRs

- [0003](../adr/0003-transactional-outbox-and-integration-events.md), [0017](../adr/0017-roles-checked-at-the-edge-and-in-each-service.md).
