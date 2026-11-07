# Finance section

- **Status:** Current
- **App and route:** staff-web, `/finance` (payment totals above the invoice list).
- **Owner:** @nielpattin
- **Last reviewed:** 2026-11-07

Tags: `[observed]` a code fact, read on 2026-10-26; `[standard]` a decision from industry practice, listed under Decisions; `[owner]` a recorded owner decision (none for this section yet). `(gap Gn)` marks target behavior the code does not meet yet, listed under Gaps. See [README](README.md).

## Purpose

- `[standard]` Finance is where a manager reads the money the pharmacy took and reverses a sale when it must be undone, with a reason on record. It does not post to an accounting ledger ([BR-FIN-001](../business-rules.md)). Stock value, missing prices and stock movements are not money owed or taken, so they live in Analytics (Inventory tab) and Inventory, as in Shopify, where Finance holds payments and payouts and the sales and inventory reports sit under Analytics.
- `[observed]` Invoices and their actions come from payment-service. The payment totals come from operations-query-service.
- `[standard]` Cash is taken and confirmed at the counter or at handover, not here (Decisions 6 and 21). Finance is the read-and-refund view of the Pharmacy Manager; the Platform Admin reads it and takes no action (BR-AUTH-010).

## Users and entry points

- Staff only; sign-in required. Shoppers see their own invoices in customer-web, not here.
- `[observed]` Navigation: **Finance** for the Pharmacy Manager (`/finance`; `sectionRoles` in `apps/staff-web/src/permissions/section-access.ts`).

| Part | Shown to | Reads | Acts |
| --- | --- | --- | --- |
| Payment totals | Pharmacy Manager | Paid, Refunded, Net | None |
| Invoices | Pharmacy Manager | Invoice list and invoice detail | Refund a `Paid` invoice (Pharmacy Manager only) |

- `[standard]` A Pharmacist has no Finance entry. Counter invoices, cash and counter refunds are in Prescriptions, Counter transactions ([staff-prescriptions-and-counter.md](staff-prescriptions-and-counter.md)).

## User stories and acceptance criteria

### US1. As a Pharmacy Manager, I read payments for my sites, so that I can review the money without changing the sales record

- Source: `[standard]` role definition and site scope; `[observed]` the current page.
- Accepted when:
  - Signed in as Pharmacy Manager, `/finance` shows the payment totals and **Invoices**.
  - No row in **Invoices** shows **Confirm cash**, for any role (gap G2).
  - The invoice list and the totals include only invoices and money of my assigned sites (gap G7, G8).
  - The Customer column shows the short id, not a name (Decision 14).
- Rules: [BR-PAY-009](../business-rules.md), [BR-AUTH-004](../business-rules.md).

### US2. As a Pharmacy Manager, I refund a paid online-order invoice with a reason, so that the sale is reversed in full and the reason is on record

- Source: `[standard]` Decisions 6, 7 and 13.
- Accepted when:
  - A `Paid` row shows **Hoàn tiền** to a Pharmacy Manager, never to a Platform Admin (gap G1). A Pharmacist sees no refund control on this section.
  - The dialog "Hoàn tiền thanh toán" has an empty, required field "Lý do hoàn tiền" with an "n/500" counter. **Hoàn tiền** stays disabled while the reason is empty or longer than 500 characters (gap G4).
  - A confirmed refund calls `POST /api/payments/{id}/refund` with `{ "reason" }`. The toast "Đã hoàn tiền." shows, and the invoice list and totals refresh.
  - A refused refund shows the server's Vietnamese message and keeps the dialog open with the reason typed.
  - `Pending`, `Failed`, `Refunded` and `Cancelled` rows show no refund control.
- Rules: [BR-PAY-003](../business-rules.md) (the role in it is gap G1), [BR-ORD-010](../business-rules.md).

### US3. As a Pharmacy Manager, I open one invoice, so that I can check its lines, payments and reconciliation against the record

- Source: `[standard]` Decisions 2, 3 and 19.
- Accepted when:
  - Selecting an invoice's code opens a detail panel in the page, not a JSON tab (gap G5).
  - The panel shows: lines (product, quantity, unit price, amount); payment (code, method, amount, status, and for a `Pending` QR invoice the transfer content); provider transactions (reference, amount, time, outcome); reconciliation (expected amount, received amount, state); refunds (reason, time, actor); and a **History** tab (gap G6).
  - Reconciliation reads `Open` (no money received), `Matched` (received equals the invoice amount), or `AmountMismatch` (received differs; the invoice stays unpaid; both amounts show in the danger tone).
  - Raw webhook bodies and signatures are never shown.
- Rules: [BR-PAY-007](../business-rules.md), [BR-PAY-006](../business-rules.md) (signature data stays out of the UI).

### US4. As a Pharmacy Manager, I filter and export invoices, so that I can work on a subset without losing rows

- Accepted when:
  - The status select offers **All statuses**, `Pending`, `Paid`, `Failed`, `Refunded`, `Cancelled`. The search (placeholder "Tìm theo số hóa đơn, mã đơn hoặc mã khách hàng") commits after a pause; `/` focuses it.
  - Rows are newest first, 100 per page with **Load more**. The list never caps silently.
  - **Created** and every other time shows in Asia/Ho_Chi_Minh (gap G14).
  - **Export** downloads `invoices.csv` with every row of the current filter. It loads the remaining pages first; if a page fails it downloads nothing and shows the error (gap G15).
  - Filters and search survive a reload (URL state). Saved views are stored under `finance-invoices`.
- Rules: [api-guide, Payments](../api-guide.md) (`GET /api/payments/invoices`).

### US5. As a Pharmacy Manager, I read the payment totals, so that I can see paid, refunded and net

- Source: `[standard]` error and time rules, dashboard rules; `[observed]` the three tiles.
- Accepted when:
  - Three tiles in this order: **Paid**, **Refunded**, **Net** (VND). Figures cover all time (Decision 17).
  - While loading, tiles show a loading state, not `0`. On error the danger alert shows and tiles show no number (gap G11).
  - A **Làm mới** control and an updated-at time sit above the tiles (gap G12).
- Rules: [api-guide](../api-guide.md) (`GET /api/finance/summary`); [BR-FIN-001](../business-rules.md).

## Contents and behavior

- `[observed]` **Payment totals:** the three tiles (US5). Money shows the summary's currency.
- `[observed]` **Invoices:** toolbar with the status select, saved views and search. Columns: Invoice (payment code, else short id), Order (hidden below the large breakpoint), Customer (hidden below the extra-large breakpoint), Amount (with currency; `VND` when the invoice has none), Status, Created (hidden below the large breakpoint), and pinned Actions. Status tones: `Pending` warning, `Paid` success, `Failed` danger, `Refunded` info, `Cancelled` neutral. Today the row actions are **Đối soát** (raw JSON in a new tab), **Confirm cash** and **Refund** (gaps G2, G5).
- `[standard]` **Invoice detail:** the panel and History tab of US3, opened from the row.
- `[observed]` Invoice amounts are not converted. Only VND is accepted ([BR-PAY-004](../business-rules.md)).

## States

- `[observed]` Loading: the table loading state for invoices; the tiles show a loading state while the summary query is pending.
- `[observed]` Error: a danger alert with the translated server message. The invoice list stays usable when the totals fail.
- `[observed]` Empty: "Chưa có bản ghi" in each table (the English key is "No records found").
- `[standard]` A row with no action still opens its detail (US3).
- `[standard]` Signed out or session ended: this section does not render. The shell ends the session visibly and returns the user to the page after sign-in ([staff shell spec](staff-shell-sign-in-and-navigation.md)).

## Out of scope

- `[standard]` Posting to an accounting ledger ([BR-FIN-001](../business-rules.md)).
- `[standard]` Creating invoices. Counter invoices are created from prescriptions by a Pharmacist.
- `[standard]` Any cash confirmation on this section. Counter cash is in Counter transactions. Online cash on delivery is confirmed at handover, on the order ([staff-online-orders.md](staff-online-orders.md); Decision 21).
- `[standard]` Partial refunds and editing an invoice or an amount ([BR-PAY-003](../business-rules.md)).
- `[standard]` A period filter on the totals (Decision 17).
- `[standard]` Stock value, reserved value, missing prices, the inventory valuation table and stock movement totals. They were on a Summary tab and were removed: Analytics (Inventory tab) shows stock value and missing prices, and Inventory shows balances and movements.
- `[standard]` The QR image and transfer content at the counter (see the prescriptions spec). Webhook administration.
- `[observed]` Shopper-side invoices (customer-web).

## Rules and designs

- Business rules: [BR-PAY-002](../business-rules.md) (cash confirmation is a Pharmacist action), [BR-PAY-003](../business-rules.md) (refund: reason, whole invoice), [BR-PAY-004](../business-rules.md) (VND), [BR-PAY-007](../business-rules.md) (reconciliation states), [BR-PAY-009](../business-rules.md) (invoice read), [BR-PAY-010](../business-rules.md) (outbox events), [BR-ORD-010](../business-rules.md) (refund of unshipped orders), [BR-AUTH-002](../business-rules.md) and [BR-AUTH-004](../business-rules.md) (role matrix, site scope), [BR-AUDIT-004](../business-rules.md) (full audit log is Platform Admin only), [BR-FIN-001](../business-rules.md).
- Role gates: `apps/staff-web/src/permissions/staff-permissions.ts` (`payment.confirmCash`, `payment.refund`, `payment.invoices.view`, `finance.summary.view`) and the `trusted-request.ts` of each service.
- [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md): payment events leave through the outbox; the finance entries are a projection of those events.
- [User guide, Finance](../user-guide.md#finance) and [API guide](../api-guide.md) (Payments; Finance).

## Decisions

Decisions 8 and 16 belonged to the Reports tab, 9 and 20 to the unused strings and the valuation, and they were removed with them; the numbers stay so that citations still resolve.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | What does Finance hold? | Payments only: the invoice list with its refund, and the paid, refunded and net totals. Stock value and stock movements are not Finance (Analytics and Inventory hold them). `[standard]` | Shopify's Finance holds balance, payouts and payments; its sales and inventory reports sit under Analytics. A figure shown in two places drifts. |
| 2 | The reconciliation link opens raw JSON. What should it show? | A panel with expected amount, received amount and state (`Open`, `Matched`, `AmountMismatch`). No raw JSON. `[standard]` | BR-PAY-007 defines the states. Counter and payment rule: reconciliation is rendered in the page. |
| 3 | SePay: should staff see the payment code and webhook status? | Yes, per invoice: payment code, transfer content for a `Pending` QR invoice, and provider transactions (reference, amount, time, outcome). Raw webhook bodies and signatures are never shown. The QR image stays at the counter. `[standard]` | Finance has to match money to invoices. Signatures and raw bodies are security data. Common practice. |
| 4 | The refund reason has no shown limit. | The field shows "n/500". Empty or over 500 blocks submit. The server limit (1 to 500) stays. `[standard]` | BR-PAY-003 range. Counter and payment rule: the limit is shown in the form. |
| 5 | Pharmacist access: the Pharmacist cannot open Finance, yet cash and refunds are Pharmacist actions. | The Pharmacist has no Finance section. Counter cash and counter refunds stay in Counter transactions. `[standard]` | Whoever takes the cash does not review the totals (segregation of duties). Owner may change (role policy). |
| 6 | Who confirms cash and refunds? The user guide says Platform Admin too. | Cash: Pharmacist only, in Counter transactions. Refund: Pharmacy Manager here, for an online-order `Paid` invoice; a Pharmacist refunds counter invoices in Counter transactions. Platform Admin reads Finance and neither confirms cash nor refunds (BR-AUTH-010). `[standard]` | Role definition; segregation of duties. Owner may change (refund policy). |
| 7 | The refund reason is pre-filled "Điều chỉnh vận hành" (counter: "Customer request"). | Start empty and required. No default. `[standard]` | A default is submitted without thought and weakens the reason on record. |
| 10 | Does Platform Admin read `/api/finance/summary`? | No. Finance is Pharmacy Manager only, and the service refuses Platform Admin. `[standard]` | Money figures are a business matter, not an administrator one, as with Analytics. |
| 11 | Does the invoice export cover all pages? | Every row of the current filter. The export loads the rest first and writes nothing if a load fails. `[standard]` | A partial payment export misstates the totals. Fail visibly. |
| 12 | Signed-out and session-expired states. | Handled by the shell, not this section. The shell ends the session visibly and returns the user afterwards. `[standard]` | The session rule applies to every page. |
| 13 | Refund of an order already handed over. | Allowed with a reason. The refund puts no stock back. Returned goods go through Inventory returns. `[standard]` | BR-ORD-010 covers only unshipped orders. Medicine handed over cannot go back on the shelf `[inference]`. |
| 14 | Should Pharmacy Managers see customer names? | No, short id only; names stay with the Pharmacist at the counter. `[standard]` | Data minimization. `customer.lookup` is Pharmacist-only in the policy. Owner may change (privacy). |
| 15 | Which sites do these figures cover? | Invoices and the totals cover the user's assigned sites; Platform Admin sees all. `[standard]` | BR-AUTH-004 and the site scope rule. |
| 17 | Do the summary totals have a period? | All time, with no period filter in this section. `[standard]` | Keeps one figure per tile, as the API answers. A period filter is a later change. Owner may change (reporting period). |
| 18 | How do the totals show they are current? | A **Làm mới** control and an updated-at time. `[standard]` | Dashboard rule: manual refresh next to the data, and the age of the numbers shown. |
| 19 | Who sees the history of an invoice? | A **History** tab in the invoice detail, from an entity-scoped read. Shown to the users who see the invoice. `[standard]` | Entity history rule. The full audit log stays Platform Admin only (BR-AUDIT-004). |
| 21 | Who confirms cash for an online cash-on-delivery order? | The Pharmacist confirms it at handover, on the online order. Not on this section. `[standard]` | Cash changes hands at handover. Role definition: the Pharmacist hands over online orders. |

## Gaps against the code (2026-10-26)

Gaps G9, G10, G16 and G17 belonged to the Reports tab, G13 to the valuation and G18 to the unused strings, and were removed with them.

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | A Pharmacy Manager refunds an online-order `Paid` invoice here (Decision 6). | The service admits Pharmacist and Pharmacy Manager on the refund route, and `refundRefusal` admits only Pharmacy Manager for an online-order invoice, only Pharmacist for a counter invoice, so a Platform Admin is refused both. The **Refund** button shows to a Pharmacy Manager on every `Paid` row, so **Refund** on a counter row fails with "Chỉ Dược sĩ được hoàn tiền hóa đơn tại quầy." | `apps/payment-service/src/modules/payment-access.ts` (`refundRefusal`); `invoices-tab.tsx`; `docs/business-rules.md` BR-PAY-003 |
| G2 | No cash confirmation on Finance; Platform Admin does not confirm cash (Decision 6). | **Confirm cash** stays in `invoices-tab.tsx`, behind `payment.confirmCash` (Pharmacist only). The service admits `confirm-counter` to Pharmacist only. No role that opens Finance passes the gate, so no row shows the button, but the code remains. | `invoices-tab.tsx`; the `trusted-request.ts` of each service |
| G3 | Online cash on delivery is confirmed by a Pharmacist at handover (Decision 21). | No staff control does it. Finance is closed to the Pharmacist. Counter transactions leaves out order invoices (`isCounterInvoice`). The online orders screen is view-only and shows only the payment status. | `apps/staff-web/src/sections/orders-section.tsx`; `sections/sales/rules.ts`; `sections/prescriptions/counter-tab.tsx` |
| G4 | Empty required refund reason with an "n/500" counter, no default (Decisions 4 and 7). | Pre-filled "Điều chỉnh vận hành" and label "Lý do hoàn tiền:"; no counter. The server enforces 1 to 500. The counter tab pre-fills "Customer request" (its spec owns that row). | `invoices-tab.tsx` (`refund`); `counter-tab.tsx` (`refund`); `payment-routes.ts` (refund schema) |
| G5 | Invoice detail panel with reconciliation and provider transactions in the page (Decisions 2 and 3). | **Đối soát** opens `/api/payments/{id}/reconciliation` as raw JSON in a new tab. The record holds only expected amount, received amount and state. No detail view exists. | `invoices-tab.tsx`; `payment-routes.ts` (reconciliation route); `payment-repository.ts` (`reconciliationRecords`) |
| G6 | **History** tab on the invoice from an entity-scoped read (Decision 19). | No invoice history exists. The audit log is Platform Admin only, so a Pharmacy Manager has no history. | `trusted-request.ts`; `docs/business-rules.md` BR-AUDIT-004; payment-service (no entity history read) |
| G7 | Invoices narrowed to the user's assigned sites (Decision 15). | `/api/payments/invoices` is not in `DEFAULT_SITE_SCOPED_PREFIXES`. `payment_invoices` has no site column (customer, order and prescription only). A Pharmacy Manager sees every site. The counter tab has the same gap. | `trusted-request.ts`; `apps/payment-service/src/modules/payments/infrastructure/schema.ts`; `payment-repository.ts` (`listInvoices`) |
| G8 | Paid, Refunded and Net for the user's assigned sites (Decision 15). | Paid, Refunded and Net read `finance_entries` with no site filter, and that table has no site column. | `apps/operations-query-service/src/modules/operations-repository.ts` (`financeSummary`); `shared/infrastructure/schema.ts` (`financeEntries`) |
| G11 | Tiles show a loading state or the error, never `0` as data (US5). | `summary?.[field] ?? 0`: tiles show `0` while the summary loads and when it fails. | `apps/staff-web/src/sections/finance-section.tsx` |
| G12 | **Làm mới** control and updated-at time (Decision 18). | Neither exists. | `finance-section.tsx` |
| G14 | Times in Asia/Ho_Chi_Minh (Decision 20). | `formatDateTime` uses the browser's time zone. | `apps/staff-web/src/staff-api.ts` (`formatDateTime`) |
| G15 | Exports cover every row of the filter; a failed load writes no file (Decision 11). | The table export writes the loaded rows only, through the visible columns. A failed page load leaves the rows loaded so far exportable. | `apps/staff-web/src/components/data-table.tsx` (`exportCurrentRows`); `invoices-tab.tsx` |
