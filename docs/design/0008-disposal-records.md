# 0008. Disposal records for expired, damaged and recalled stock

- **Status:** Implemented on the owner's instruction; review still welcome
- **Author:** @nielpattin
- **Date:** 2026-10-30

## Summary

Pharmacy staff can record the destruction of stock as a **disposal record** (biên bản tiêu hủy): one site, a reason, optional notes and one or more batches with a quantity each. A Pharmacist or Warehouse Staff member proposes it; a Pharmacy Manager who did not propose it approves or rejects it. Approval takes the quantities off the shelf and writes a `Disposal` ledger entry per line in one transaction, and the approved record can be printed as a signed slip. `inventory-service` owns the tables, routes and stock movement; `staff-web` adds a **Disposals** tab to the Control group; the edge policy and the service role rules name the three roles.

## Motivation

The quality page records a batch verdict (released or rejected), and adjustments can move stock, but neither records *why stock was destroyed*. An expired batch that must leave the shelf today is recorded as a generic negative adjustment, which does not say which batches were destroyed together, why, or who witnessed it. A pharmacy that destroys medicine needs a document for the inspection file: reason, batch references, quantities, the proposer and the approver. The lecturer's third tier asks for exactly this record.

## Goals

- One record names every batch destroyed in a session, not one adjustment per batch.
- Stock moves only once, on approval, and never by the proposer.
- The record answers what was destroyed, where, why, by whom and when, and prints as an A4 slip with signature blocks.
- The approval re-checks stock, so a sale that consumed a batch after the proposal refuses the whole approval instead of going negative.
- A rejected record leaves stock untouched and stays readable.

## Non-goals

- No integration events and no cross-service table change. The stock ledger and availability update are the existing inventory paths.
- No automatic creation from an expiring-batch alert. A person decides what to destroy and proposes it.
- No supplier credit or return-to-supplier flow in this record; returns stay their own flow.
- No image attachments or scanned signatures. The slip has blank signature blocks and is printed or saved as PDF by the browser.
- No deletion or editing of a decided record.

## Proposed design

### Contracts

Browser routes under the existing `/api/inventory` prefix. The local gateway (`routes.conf`) and the ALB already forward `/api/inventory*`, so no routing change is needed.

| Route | Roles | Purpose |
| --- | --- | --- |
| `GET /api/inventory/disposals` | Pharmacist, Pharmacy Manager, Warehouse Staff (Platform Admin reads) | Page of records with their lines, status filter, `q`, site scope, `limit`/`cursor` |
| `POST /api/inventory/disposals` | Pharmacist, Warehouse Staff | Propose `{siteId, reason, note?, lines:[{productBatchId, storageLocationId, quantity}]}` |
| `POST /api/inventory/disposals/{id}/approve` | Pharmacy Manager, not the creator | Approve `{decisionNotes?}` and move stock |
| `POST /api/inventory/disposals/{id}/reject` | Pharmacy Manager, not the creator | Reject `{decisionNotes?}`, no stock change |

`GET` answers one page as a plain array, newest first, with `X-Next-Cursor` while another page follows, like every inventory list. Each row carries its `lines`, and each line carries the batch number. A malformed cursor answers `400 invalid_cursor`; a bad body answers `400 invalid_request`; an out-of-site record or self-approval answers `403`; a stale quantity or an already-decided record answers `409`.

The service adds `/api/inventory/disposals` to the site-scoped list prefixes and names the roles above in `middleware/trusted-request.ts`, and each route checks roles, site scope and self-approval again.

### Data model

Inventory migration `0015_disposal_records`:

`disposal_records` — `id`, `site_id`, `reason` (`Expired`, `Damaged`, `Recalled`, `Other`), `note`, `status` (`PendingApproval`, `Approved`, `Rejected`), `created_by`, `decided_by`, `decision_notes`, `decided_at`, `created_at`, `updated_at`. Indexes on `(site_id, created_at)` and `(created_at, id)`.

`disposal_lines` — `id`, `disposal_id`, `product_id`, `product_batch_id`, `storage_location_id`, `quantity numeric(18,6)`. Unique `(disposal_id, product_batch_id, storage_location_id)`, index on `disposal_id`.

The product id is copied from the batch when the proposal is written, so the ledger entry and the line agree even if the batch is later retired.

### Events

None. The ledger entry is the durable record; availability is recomputed through `recordSiteAvailability`, the same path as every other stock change (BR-INV-010).

### Proposal and approval flow

1. The drawer lists the site's balances with available stock, expiry first. The proposer ticks the batches and sets a quantity (default: the whole available quantity), picks a reason, and may add a note.
2. `createDisposal` validates in one transaction that each batch exists and each line is within the available quantity at that site and location, then writes the record and lines. Stock does not move.
3. A manager sees the row, approves or rejects it. Self-approval is refused by the service, and the UI hides the decision actions from the proposer.
4. `transitionDisposal` locks the record and each balance, re-checks `onHand - reserved >= quantity`, subtracts the quantity, writes a `Disposal` ledger entry (`referenceType = Disposal`, `referenceId` = record id, reason and note copied), refreshes availability per product, and sets the record to `Approved`. Any failure rolls the whole decision back.
5. The approved row offers **Print slip**: a self-contained A4 HTML document with the site, reason, note, line table, total and three signature blocks. Staff text is escaped before it reaches the document.

### Alternatives rejected

- **One negative adjustment per batch.** Loses the shared reason and the group of batches, and the adjustment reason is free text rather than a category.
- **Deduct on proposal.** A proposal is a request; the shelf keeps the stock until a second person agrees, so a sale can still use a batch that was proposed by mistake.
- **Delete a record instead of rejecting it.** A destroyed batch needs an auditable trail; a rejected record is the trail that says it was not destroyed.

## Security and permissions

`inventory.disposals.view` (Pharmacist, Pharmacy Manager, Warehouse Staff, Platform Admin reads), `inventory.disposal.create` (Pharmacist, Warehouse Staff), `inventory.disposal.decide` (Pharmacy Manager, separation of duties). The staff-web hides every action the signed-in role cannot use and hides the action column when no visible row offers one.

## Tests

- `inventory-repository-disposals.test.ts`: proposal writes no stock; over-available proposal refused; approval subtracts and writes `Disposal` entries; a second decision refused; rejection leaves stock; status and batch-number search.
- `inventory-routes.test.ts`: create, validation (empty lines, duplicate batch+location, manager cannot create), approval and rejection, self-approval refusal.
- `trusted-request.test.ts`: the role matrix for read, propose and decide.
- `disposal-slip.test.ts`: totals, escaping and batch lines.
- Browser verification in container mode: propose as `staff-pharmacist`, approve as `staff-manager`, check the balance and ledger through SQL, print dialog.

## Rollout

Apply inventory migration `0015` with `pnpm run db:migrate` (Compose does not run it), rebuild with `pnpm run local:up`, restart the gateway if its routes were cached. No backfill and no seed change: the demo seed leaves expiring batches on purpose, so the flow has data.

## Open questions

None blocking. A future change could attach a scanned destruction certificate; that needs object storage and a new column, so it is left out.
