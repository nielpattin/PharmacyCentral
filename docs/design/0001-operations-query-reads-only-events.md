# 0001. Operations query reads only through events

- **Status:** Draft
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

operations-query-service builds its dashboard and finance figures from its own projections only, as [AGENTS.md](../../AGENTS.md) and [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md) require, so it stops calling catalog-service, inventory-service and sales-service. The owners publish versioned state events on `pharmacy.events` for the rows the figures need, operations-query stores them and counts or sums them locally, and the three `*_SERVICE_URL` variables are removed. Affected: catalog, inventory (with procurement), sales, operations-query, ops-console-service (manifest and tests), Compose, Terraform variables, and the docs.

## Motivation

The rule is stated in [AGENTS.md](../../AGENTS.md) and [architecture.md](../architecture.md#data-ownership). [ADR 0002](../adr/0002-service-owned-databases.md) and [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md) both record the HTTP reads as a known deviation in their Consequences. The code still does it:

- `dashboard()` in [operations-repository.ts](../../apps/operations-query-service/src/modules/operations-repository.ts) (line 188) makes 11 HTTP reads through `loadLiveOperations` (line 368), `loadCounts` (line 391) and `readJson` (line 431). `financeSummary()` (line 259) makes 14: those, plus two `/inventory/movements/summary` reads and `/pricing/base-prices`.
- `readJson` turns a failed unscoped read into `undefined`. The fallbacks that follow (lines 222-246, keys such as `catalog_sites`, `inventory_quantity_on_hand`, `sales_open_prescriptions`) read keys that nothing writes: `apply()` writes only event-type keys and `inbox:` keys (lines 58-69). A network-wide dashboard therefore shows 0 while an owner is down. A scoped read throws and answers 5xx.
- `projectionLag` reads the key `projection:last-occurred-at` (line 250), which nothing writes, so it is always `null`.
- The wiring spans [docker-compose.yml](../../docker-compose.yml) (lines 611-613), the fail-fast checks in [main.ts](../../apps/operations-query-service/src/main.ts) (lines 19-28), [terraform.tfvars.example](../../deploy/aws/terraform.tfvars.example) (lines 71-74; `main.tf` has no URL, the ECS values come from `service_environment`), and the `dependsOn` of operations-query in [service-manifest.ts](../../apps/ops-console-service/src/modules/system/service-manifest.ts) (line 105), which `service-catalog.test.ts` asserts. [architecture.md](../architecture.md) lines 92, 135 and 159-162 and the [runbook](../runbook.md#named-local-urls) (line 75) repeat it.
- Events do not carry what the figures need (the table below). The audit path cannot carry it either: an audit row is written after the response, and a failed insert is only logged ([runbook](../runbook.md#messaging-operations)).

| Figure | Today | What the existing events carry | Needed |
| --- | --- | --- | --- |
| totalProducts, sites, storage locations, suppliers | catalog lists and `/products/count` | `catalog.audit.v1` only: action and ids, no name, no `isActive` | `catalog.*.changed.v1` |
| totalQuantityOnHand, reserved, balanceCount, lowStockBatchCount | inventory `/inventory/balances` (full list) | `inventory.availability.changed.v1` carries only `inStock` per product and site | `inventory.balance.changed.v1` |
| expiringBatchCount, batch numbers | inventory `/inventory/batches` (full list) | nothing | `inventory.batch.changed.v1` |
| inventoryValue, reservedValue, missingPriceCount | `/pricing/base-prices?day=` | audit only; no price value | `catalog.price.changed.v1` |
| receiptQuantity, dispensedQuantity, movement sums | `/inventory/movements/summary` | nothing; the stock ledger is not published | `inventory.stock-movement.recorded.v1` |
| pendingTransferCount | transfers count | audit only; no status | `inventory.transfer.changed.v1` |
| openStocktakeCount, pendingAdjustmentCount | counts | audit only | `inventory.stocktake.changed.v1`, `inventory.adjustment.changed.v1` |
| receiptCount | goods-receipts count | audit only; no site lines or status | `procurement.goods-receipt.recorded.v1` |
| openPrescriptionCount | prescriptions count | `sales.prescription.created.v1` has `siteId`; `dispensed.v1` has no `siteId` and cannot tell Partially from Dispensed; `cancelled.v1` has no `siteId` | additive fields |

One more fact constrains the design. The relay sorts by `occurredAt`, whose default is `now()`, the start of the transaction (`outbox_messages` in each owner's `schema.ts`), so publication order is not commit order; only `inventory_balances` has a `version` column.

## Goals

- operations-query makes no HTTP call to catalog, inventory or sales: no `*_SERVICE_URL` in its code, Compose or Terraform, and no outbound `internalServiceHeaders()` use.
- Every field of `GET /api/dashboard/summary` and `GET /api/finance/summary` equals the HTTP-based answer over the same data (reconciliation diff of zero), and the response shapes do not change. (Later, the Finance summary was cut to `paid`, `refunded` and `net`; the other figures it held were stock value and movement totals, which Analytics and Inventory show.)
- Counts are `COUNT(*)` over projection tables with no page limit, exact above 1,000 rows (tested).
- Site scope per BR-REPORT-001 and BR-AUTH-004 holds for every figure.
- The dashboard answers 200 while catalog, inventory or sales is stopped, and `projectionLag` shows the staleness.
- Duplicate, reordered and backfilled events never change a value once a newer version has been applied.

## Non-goals

- No change to the audit path, `audit_events`, or finance entries (BR-FIN-001).
- No change to dashboard response fields, to owners' existing HTTP routes, or to existing event payloads beyond the additive fields below.
- No change to staff-web or search-service. No cross-database reads, CDC or shared views ([ADR 0002](../adr/0002-service-owned-databases.md)).

## Proposed design

Owners write state events in the same transaction as the change. operations-query upserts them by version and computes every figure from its own tables. A one-off backfill replays current owner state through each outbox.

### Contracts

- No new HTTP route. The bodies of `GET /api/dashboard/summary`, `/api/operations/dashboard`, `/api/finance/summary` and `/api/operations/finance` stay as documented under [Query projections](../api-guide.md#query-projections).
- Remove `POST /internal/events` ([operations-routes.ts](../../apps/operations-query-service/src/modules/operations-routes.ts), line 128). It is the only HTTP path that writes projections, and no caller or document in the repo uses it. AGENTS.md says to preserve routes, so this needs approval (open question 1).
- Each owner declares its payload schemas in `src/contracts/integration-events.ts` (zod, with a contract test). operations-query declares its own parse schemas for the same types in `src/contracts/integration-events.ts`; applications do not import each other.

### Data model

- Owners, one Drizzle migration per service, run by the owning role: add `version integer not null default 1` to the tables `products`, `product_prices`, `sites`, `storage_locations` and `suppliers` in catalog-service's database; to `product_batches`, `transfer_orders`, `stocktakes` and `stock_adjustments` in inventory-service's; and to `prescriptions` in sales-service's. Every UPDATE sets `version = version + 1` in the same statement. `inventory_balances.version` already exists. A hard-deleted product (`deleteProduct`) emits a tombstone.
- operations-query migration `0004_operations_projections.sql` (additive): `projected_products`, `projected_sites`, `projected_storage_locations`, `projected_suppliers`, `projected_product_prices`, `projected_batches`, `projected_balances`, `projected_ledger_entries` (indexed on `(site_id, movement_type, occurred_at)`), `projected_transfers`, `projected_stocktakes`, `projected_adjustments`, `projected_goods_receipts`, `projected_prescriptions`, and `projection_state` (family, last occurred at, last applied at, backfill complete). Every row keeps `version` and `removed`.
- Counts use the owners' filters, per BR-REPORT-004 to 007: open prescriptions are status not in (Dispensed, Cancelled); pending transfers are status in (PendingApproval, Draft, Approved, InTransit), matched on source or destination site; open stocktakes are status not in (Completed, Cancelled); pending adjustments are status Pending; receipts are all rows in scope; products are `is_active AND NOT removed`.
- Valuation ports `listBasePricesOn` ([drizzle-store-repository.ts](../../apps/catalog-service/src/modules/stores/infrastructure/drizzle-store-repository.ts), line 720) to SQL over `projected_product_prices`: Published, site-less, window contains the day, factor above zero, `DISTINCT ON` product, base unit first, then latest `effective_from`, then id. BR-PRICE-006 keeps windows from overlapping, so the choice is deterministic.

### Events

The envelope is unchanged: `{ eventId, eventType, occurredAt, actorId?, payload }`, routing key equal to `eventType`, as relayed by each `outbox-publisher.ts`. Two rules apply.

- **State events** (`*.changed.v1`) carry the whole current state of one aggregate, plus `version` (the owner's column) and `removed` for tombstones. The consumer upserts only when the incoming version is greater than the stored one. Equal or lower is a no-op, so redelivery, reordering across producers and backfill cannot change a value once a newer version is applied.
- **Movement and receipt events** are immutable and keyed by their own id, inserted with `ON CONFLICT DO NOTHING`.

New events, with their payload fields:

- `catalog.product.changed.v1`: productId, sku, name, category, prescriptionRequired, isActive, removed, version.
- `catalog.site.changed.v1`, `catalog.storage-location.changed.v1`, `catalog.supplier.changed.v1`: id, code, name, siteId (locations), isActive, removed, version.
- `catalog.price.changed.v1`: priceId, productId, productUnitId, conversionFactorToBaseUnit, isBaseUnit, siteId (null), unitPrice, currency, status, effectiveFrom, effectiveTo, version. Re-emitted for every price of a unit when the unit changes.
- `inventory.batch.changed.v1`: productBatchId, productId, batchNumber, expiryDate, status, qualityStatus, isActive, version.
- `inventory.balance.changed.v1`: balanceId, productBatchId, productId, siteId, storageLocationId, quantityOnHand, quantityReserved, version.
- `inventory.transfer.changed.v1`, `inventory.stocktake.changed.v1`, `inventory.adjustment.changed.v1`: id, siteId (or source and destination), status, version.
- `inventory.stock-movement.recorded.v1`: ledgerEntryId, productId, productBatchId, siteId, storageLocationId, movementType, quantityDelta, quantityAfter, occurredAt.
- `procurement.goods-receipt.recorded.v1`: goodsReceiptId, siteId, status.

Additive fields on existing events; the current consumers ignore unknown fields:

- `sales.prescription.created.v1` adds `status: "Pending"` and `version: 1`.
- `sales.prescription.dispensed.v1` adds `siteId`, `status` (the stored PartiallyDispensed or Dispensed) and `version`.
- `sales.prescription.cancelled.v1` adds `siteId`, `status: "Cancelled"` and `version`.

Emission sits in the same transaction as each write: catalog product, site, location, supplier and price writes, and the import transaction in `catalog-import-service.ts`; inventory's ten `stockLedgerEntries` inserts, twelve `inventoryBalances` updates (reservations change `quantityReserved` too), and batch, transfer, stocktake and adjustment writes; procurement's receive path; sales' prescription create (`sales-repository.ts`, line 601), cancel (line 727) and dispense (line 826). The existing availability event stays.

Routing: the state and movement families write projection rows only, with no `audit_events`, `finance_entries` or counter. Existing event types keep their current rows.

Backfill: a one-off owner command (`pnpm --dir apps/<service> backfill:operations-projection`, run as the owning role) reads each table by primary key in batches of 500, and inserts one `*.changed.v1` outbox row per record in each batch transaction, with `origin: "backfill"` in the payload. The relay publishes them like live rows. There is no cross-database read and no new route, and versions make live and backfilled events safe to interleave.

### Security
<!-- anchor: security-and-csrf -->

- No browser mutation and no authentication change. The trusted-request middleware still gates every read, and `listSiteIds(request)` remains the only scope input (BR-AUTH-004, BR-REPORT-001).
- Site columns on every projected row: balances, ledger, stocktakes, adjustments, receipts, prescriptions and storage locations by `site_id`; transfers by source or destination; sites by `id`. Prices are site-less and visible to every reader. Products and suppliers stay network-wide, and batches are narrowed to those with balances at the reader's sites, as today.
- Removing the outbound calls also removes the internal system identity that operations-query presents to sales, which `readsEveryOrder` ([sales-routes.ts](../../apps/sales-service/src/modules/sales-routes.ts), line 47) treats as reading every order. `INTERNAL_SERVICE_SECRET` stays required, because the middleware verifies inbound `x-internal-service-secret` calls; only the outbound helper `internal-service-headers.ts` goes.
- No new secret or external credential.

### Observability

- `pharmacy_projection_apply_total{family,outcome}`, with outcomes `applied`, `stale` and `duplicate`. A rising `stale` rate shows reordering, which is expected.
- `pharmacy_projection_lag_seconds{family}`: now minus the newest applied `occurredAt`, read from `projection_state`. It replaces the always-null `projectionLag`.
- `pharmacy_projection_backfill_rows{service}` while a backfill runs.
- Business Health gets a "Projection lag" row. A proposed `Projection lag` warning fires above 300 s for 10 minutes; its runbook goes under [Alert runbooks](../runbook.md#alert-runbooks). The existing consumer metrics stay.

## Alternatives considered

- **Relax AGENTS.md to allow read-only HTTP queries.** It is the cheapest option and gives live counts with no new events. Rejected: it makes 11 to 14 calls per request, and their payloads (balances, batches, base prices) grow with stock. Any owner outage changes the dashboard, to a silent 0 or a 5xx. It requires superseding ADR 0002 and 0003 and rewriting AGENTS.md, and nothing enforces "read-only". It stays the fallback if this work is cancelled, and its fallback bug still has to be fixed.
- **Owners publish their own per-site aggregates.** Rejected: each owner would keep counters or recount on every write, and valuation and movement figures still need the rows.
- **Delta events (+1 and -1 per transition).** Rejected: a lost or duplicated event drifts silently, cross-producer reordering makes the sign meaningless without versions, and nothing can reconcile the result.
- **Order by `occurredAt`.** Rejected: it is transaction start time, not commit order.
- **CDC or read replicas of owner databases.** Rejected: ADR 0002 forbids cross-database reads, the repo has no CDC infrastructure, and the outbox already exists.
- **Hybrid: events for counts, HTTP for valuation and movements.** Rejected: it keeps the deviation and the outage behavior for the heaviest figures.

## Rollout and migration

1. Owner migrations: add `version` (default 1) in catalog, inventory and sales, using `pnpm run db:migrate`. These are additive.
2. operations-query release A: migration `0004`, the state-event consumer and routing, and `projection_state`. It still reads HTTP. It must ship before any producer emits a state event, because the current consumer would write those events into `report_rows`.
3. Producer release for catalog, inventory (with procurement) and sales: emit the new events and additive fields in the same transactions.
4. Backfill per owner, in order: catalog, then inventory, then sales. Each command runs once and logs its row counts. Watch `pharmacy_projection_backfill_rows`.
5. Reconciliation gate: a throwaway script (deleted in step 7) compares projection counts with the owners' `/…/count` endpoints, and valuation with the HTTP answer, for the network and each site. Switch only after zero differences in two runs an hour apart.
6. operations-query release B: the repository reads projections. Delete `readJson`, `fetchRows`, `fetchCount`, `loadLiveOperations`, `loadCounts`, the counter fallbacks, the outbound use of `internal-service-headers.ts`, the unused in-memory `ProjectionStore` ([projection-store.ts](../../apps/operations-query-service/src/modules/projections/application/projection-store.ts), used only by its test), and, if approved, `POST /internal/events`. Remove the three URL variables from `main.ts`, `docker-compose.yml`, `terraform.tfvars.example` and the live ECS environment. Set operations-query's `dependsOn` to `[]` and update `service-manifest.test.ts` and `service-catalog.test.ts`. Update [architecture.md](../architecture.md) (lines 92, 135, 159-162), [api-guide.md](../api-guide.md) (lines 325-327), the runbook's Named local URLs paragraph (line 75), the LikeC4 files `model/relationships-usage.c4` (lines 88-95) and `views/flows.c4` (lines 124-127), and CHANGELOG under Unreleased. Record ADR 0014 when accepted; it marks the ADR 0002 and 0003 deviations resolved. Do not edit those ADRs.
7. Cleanup: delete the reconciliation and backfill commands.

Rollback: before step 6, redeploy release A, since owners received only additive changes. After step 6, redeploy release A with the three URLs restored. If a pre-release-A consumer ran after step 3, delete rows with the new state-event types from `report_rows`.

## Testing

- operations-query, Vitest with PGlite as in [operations-repository-counts.test.ts](../../apps/operations-query-service/src/modules/operations-repository-counts.test.ts): the version rule (versions 3, 1, 2 leave 3; a duplicate is a no-op; a tombstone at 4 blocks a stale 3); exact counts over 1,200 open prescriptions across two sites, unscoped and scoped; status sets table-driven per BR-REPORT-004 to 007; scope cases per BR-AUTH-004 (a transfer scoped only by destination, site-less prices); a partially dispensed prescription counted as open; valuation fixtures matching catalog's `listBasePricesOn` cases (base unit beats a larger unit, latest effective date, inclusive `effective_to`, missing price); regression tests showing that existing event types keep their audit, report and finance rows, and that state events write none.
- Owners: each write path asserts one outbox row in the same transaction. A forced failure inside the transaction leaves neither the change nor the row. Version increments are tested, and each new payload has a contract test.
- Backfill: a fixture database, backfilled, then applied to an empty projection, must reproduce the owners' counts and valuation.
- Manifest tests in `apps/ops-console-service/src/modules/system/`.
- Stack verification: `pnpm run local:up`, then `docker compose ps` must show every service healthy. Sign in as `staff-admin` (state file, per AGENTS.md) or through `POST /api/auth/login` on `http://api.pharmacy.localhost`, call `GET /api/dashboard/summary`, and compare each count with `COUNT(*)` run as admin on the owners' databases.
- Load: a new k6 scenario `tools/k6/scenarios/dashboard.js` at 1,000 VUs with no sleep, run at the target directly. Compare p95 and error rate with the HTTP baseline on the same data, before step 6.
- Chaos: a new `owner-outage` scenario in `tools/chaos/scenarios` stops catalog, inventory and sales for 60 s. The dashboard keeps answering 200, and `projectionLag` grows.

## Open questions

1. Approve removing `POST /internal/events`, despite the route rule in AGENTS.md. Owner: maintainers.
2. Event volume: one `stock-movement` event per ledger row. Measure broker and quorum-queue cost at step 4. Owner: infrastructure.
3. All-time `receiptQuantity` and `dispensedQuantity` need the full ledger. Replay all of it, or start at cutover and mark earlier totals unavailable? Owner: product.
4. BR-REPORT-002 and 003 semantics: `includeZeroBalances` defaults to true, so zero-quantity rows count as low stock; network-wide, every batch expiring on or before today plus 30 days counts, including batches with no stock; scoped readers count only batches with a balance at their sites. Keep, or align to the business rule? Owner: pharmacy manager.
5. Is the price-selection rule duplicated in catalog and operations-query, or moved to a shared package under `packages/`? Owner: maintainers.
6. The `eventEnvelopeSchema` in each `src/contracts/common.ts` (metadata plus payload) does not match what the relay publishes. Align it or delete it. Owner: maintainers.
7. Backfill lane: the same queue (proposed) or a separate exchange so live events are not delayed? What duration is acceptable? Owner: operations.
8. `inbox:` keys in `projection_counters` grow with every event. Retention is out of scope here. Owner: maintainers.

## Related ADRs

- [ADR 0002](../adr/0002-service-owned-databases.md): the deviation this RFC removes; cross-service data moves through events.
- [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md): the outbox, at-least-once delivery, and the known deviation.
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): catalog and inventory own prices and stock, which valuation follows.
- [ADR 0013](../adr/0013-observability-and-system-console.md): the metrics and dashboards proposed above.
- Business rules: [business-rules.md](../business-rules.md) BR-EVT-001, BR-EVT-004, BR-REPORT-001 to 007, BR-AUTH-004, BR-FIN-001 to 003 and BR-PRICE-006.
- Proposed ADR 0014 records the decision when accepted (see [docs/adr/README.md](../adr/README.md)).
