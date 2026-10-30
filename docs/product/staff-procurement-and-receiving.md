# Procurement and receiving

- **Status:** Current
- **App and route:** staff-web, `/procurement` (tab **Purchase orders**) and `/receiving` (tab **Goods receipts**). Both mount `ProcurementSection` (`apps/staff-web/src/sections/procurement-section.tsx`). The tab is in the URL as `?tab=`. A role sees only the tabs it may use (`sections/procurement/tabs.ts`).
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code or document fact on 2026-10-26; `[standard]` a decision from industry practice, with the reason in the Decisions table; `[owner]` a recorded owner decision (none on this page yet). Gaps against the code are listed in the last table, marked `(gap Gn)` where an acceptance criterion depends on them. See [README](README.md).

## Purpose

The two pages record what the pharmacy orders from a supplier (purchase orders, from **Nháp** to **Đã nhận**) and what arrives at a site (goods receipts, one batch per line with an expiry date). A receipt adds stock, and each new batch waits for quality release before anyone can sell or dispense it (BR-RECV-008). Buying and receiving are separate duties, so the person who orders does not confirm the delivery, and the person who receives does not release the batch.

## Users and entry points

- `[standard]` **Pharmacy Manager**: creates, edits (while Draft), approves and cancels purchase orders for assigned sites. Opens `/procurement`, which shows the Purchase orders tab only (Goods receipts needs `goodsReceipt.view`).
- `[observed]` **Warehouse Staff**: records goods receipts and reads purchase orders for assigned sites, read-only, to receive against them. Opens `/receiving` (Goods receipts is the default tab). Cannot approve or cancel.
- `[observed]` **Platform Admin**: reads both pages for every site (BR-AUTH-003). It creates, approves and cancels no purchase order and records no receipt (BR-AUTH-010).
- `[standard]` **Pharmacist**: no access to these pages. Batch quality is decided on the Quality page (see US4).
- `[observed]` Sign-in is required. Lists and writes are limited to the employee's sites (BR-AUTH-004). Role gates are enforced at the edge (`deploy/aws/lambda/policy.mjs`) and in the service.
- `[observed]` Create buttons open a side drawer: **Tạo đơn đặt hàng** on Purchase orders, **Nhận hàng** on Goods receipts, each also on key **N**.

## User stories and acceptance criteria

### US1. As a Pharmacy Manager, I create a purchase order for a supplier, so that expected stock is recorded before goods arrive

- Source: `[observed]` [user guide](../user-guide.md#purchasing-and-receiving); BR-PROC-001 to BR-PROC-004.
- Accepted when:
  - **Tạo đơn đặt hàng** is enabled for a Pharmacy Manager only. Other roles see it disabled with the gate's reason.
  - Supplier and site are required. Each line needs a product and a whole-number ordered quantity greater than 0. A decimal quantity is refused with 400 `invalid_request` (gap G14).
  - A request with no lines is refused with 400 `invalid_request`.
  - A missing or unknown supplier, site or product is refused with 400 `invalid_reference` and the title "Nhà cung cấp, site hoặc sản phẩm không tồn tại." (gap G4).
  - A `siteId` outside the employee's sites is refused with 403 `site_access_denied`.
  - A saved order shows "Đã tạo đơn đặt hàng." and appears with status **Nháp**.
  - A blank number is generated as `PO-<timestamp>-<n>`. A number already in use is refused with 409 "Số đơn đặt hàng đã tồn tại." (gap G15).
  - The create writes an audit row with actor, site and entity (BR-AUDIT-002).

### US1a. As a Pharmacy Manager, I correct a Draft before it is approved, so that a typo does not force a cancelled order

- Source: `[standard]` Decision 11.
- Accepted when:
  - A Draft's supplier, site, expected date, notes and lines can be changed, with the same checks as create (gap G2).
  - An order in **Đã duyệt**, **Nhận một phần**, **Đã nhận** or **Đã hủy** refuses any edit with 409 "Chỉ đơn nháp mới sửa được." (gap G2).
  - Each edit writes an audit row. A Draft is never deleted; its exit is cancel.

### US2. As a Pharmacy Manager, I approve or cancel a purchase order, so that only a checked order can receive goods

- Source: `[observed]` BR-PROC-005, BR-PROC-006; `[standard]` Decision 2.
- Accepted when:
  - **Duyệt** appears only on a Draft and asks "Duyệt đơn đặt hàng?". Success shows "Đã duyệt đơn đặt hàng." and status **Đã duyệt**.
  - The creator of an order cannot approve it, from the row, the drawer, bulk approve or the API. The refusal is 409 "Bạn không thể duyệt đơn do chính mình tạo." (gap G1).
  - Approving a non-Draft order is refused with 409 "Chỉ đơn nháp mới duyệt được."
  - **Hủy** appears on Draft, Approved and PartiallyReceived orders and needs the order number typed first. Success shows "Đã hủy đơn đặt hàng." Cancelling a Received or Cancelled order is refused with "Đơn đặt hàng ở trạng thái này không thể hủy."
  - Cancelling a PartiallyReceived order cancels only the unreceived part. Goods already received stay in stock.
  - **Duyệt mục đã chọn** approves each selected Draft that the actor did not create. It reports "Đã duyệt {done} trên {total} đơn đặt hàng." and "Chưa duyệt: {list}.", naming every order it left unchanged.
  - Warehouse Staff and Platform Admin see no Approve, Cancel or Create control, and the API answers 403.
  - Approve or cancel on an order at a site outside the actor's sites is refused with 403 `site_access_denied`.

### US3. As Warehouse Staff, I record goods received, so that stock and the order both reflect the delivery

- Source: `[observed]` BR-RECV-001 to BR-RECV-007; `[standard]` Decisions 4 to 8, 12 to 15.
- Accepted when:
  - **Nhận hàng** asks for receipt number, supplier, site, storage location and at least one line. The purchase order is optional. Storage locations narrow to the chosen site.
  - Each line needs a product, a batch number (1 to 100 characters), an expiry date and a whole-number quantity greater than 0. Manufactured date, manufacturer and line notes are optional.
  - With a linked order, the order must be Approved or PartiallyReceived. Otherwise: "Đơn đặt hàng này chưa duyệt hoặc đã nhận đủ, không nhận thêm được." (BR-RECV-005).
  - With a linked order, the supplier and site must equal the order's. Otherwise 400 "Nhà cung cấp hoặc site không khớp đơn đặt hàng." (gap G7). An order at a site outside the actor's sites is refused with 403 `site_access_denied`.
  - Each line's product must be on the linked order. Otherwise: "Sản phẩm không có trên đơn đặt hàng này." (gap G6).
  - A line that would exceed the ordered quantity is refused with "Số lượng nhận vượt quá số lượng đã đặt." Nothing is saved, and two receipts submitted together cannot both pass the check (gap G12).
  - A saved receipt shows "Đã tạo phiếu nhập hàng." The order becomes **Nhận một phần**, or **Đã nhận** once every line is complete.
  - A line with an expiry date before today (Asia/Ho_Chi_Minh) is refused: "Hạn dùng đã qua, không nhận hàng." (gap G9).
  - A line whose product and batch number already exist with another expiry date is refused: "Lô đã tồn tại với hạn dùng hoặc thông tin khác." The same message applies when a given manufacturer, manufactured date or supplier differs from the batch's (gap G8).
  - A line for a batch that is Rejected is refused: "Lô đã bị từ chối kiểm định, không nhận thêm." (gap G10).
  - The receipt date is entered by the receiver, defaults to today, and is refused when later than today or earlier than 7 days before today (gap G16).
  - A receipt number already in use is refused with 409 "Số phiếu nhập đã tồn tại." (gap G15).
  - The receipt, its lines, the order update, the batch, the stock movements and the outbox event are written in one transaction. A failure in any step saves none of them (gaps G11, G13).
  - The receipt appears in the list. Its detail drawer lists each line with batch number, expiry date and quantity.

### US4. As Warehouse Staff, I see that a received batch cannot be sold until a Pharmacist releases it

- Source: `[observed]` BR-RECV-008, BR-QUALITY-001 to BR-QUALITY-004; `[standard]` Decisions 1 and 15 (release is a Pharmacist decision, not a warehouse one).
- Accepted when:
  - A new batch is **Chờ kiểm tra** (`PendingQc`). It is not counted as sellable or reserved, even though its on-hand already includes the receipt. Check available quantity, not on-hand (BR-QUALITY-003).
  - **Đã đạt** (Release) and **Từ chối** (Reject) are available to Pharmacist and Pharmacy Manager. Warehouse Staff and Platform Admin see the batch read-only.
  - After release, the batch is sellable until its expiry date (BR-QUALITY-004).
  - A receipt into a batch that is already Released adds sellable stock at once. A receipt into a Rejected batch is refused (US3).

### US5. As a Pharmacy Manager or Warehouse Staff, I see the history of one purchase order or receipt, so that I can see who changed it and when

- Source: `[standard]` Decision 16 (entity history, not the audit log).
- Accepted when:
  - The purchase order and receipt detail drawers have a **History** tab listing that record's events with time, action and actor (gap G18).
  - Anyone who can open the record can open its History. The tab does not call `/api/audit/logs`, which is Platform Admin only (gap G18).

### US6. As a Pharmacy Manager, I review reorder suggestions and create draft purchase orders in bulk, so that I stop reordering by eye

- Source: `[owner]` 2026-10-28; formulas `[standard]` (BR-PROC-007, BR-PROC-008, [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md)).
- Accepted when:
  - Procurement has the tab **Gợi ý đặt hàng** for a Pharmacy Manager, who may create drafts from it; Platform Admin reads the tab and creates nothing. The site is required and defaults to the first assigned site.
  - The list shows, per product grouped by supplier: available, on order, daily sales speed, lead time (marked when it is the default and not observed), reorder point, suggested quantity and days of cover. The window, cover days, safety days and default lead time are inputs.
  - A row with no known supplier cannot be selected until a supplier is chosen. Quantities are editable positive integers.
  - **Tạo đơn nháp** creates one `Draft` purchase order per supplier for the selected rows in one step, or none when any reference fails. Nothing is approved or sent; approval stays with another manager (US2).
  - A product already on a Draft or Approved order at the site counts as on order, so creating the drafts twice does not suggest it again.
  - Test: sell stock below its reorder point, open the tab, select two products of one supplier and create; one Draft order with two lines appears in Purchase orders, and the tab no longer suggests those two.

## Contents and behavior

`[observed]` unless marked otherwise.

**Purchase orders tab (`/procurement`)**

1. Header button **Tạo đơn đặt hàng** (key **N**), gated by `purchaseOrder.create`.
2. Search by purchase order number, status filter (Nháp, Đã duyệt, Nhận một phần, Đã nhận, Đã hủy), saved views, CSV export.
3. Columns: Number, Status, Site, Supplier, Expected date, Created. Row actions **Duyệt** (Draft only) and **Hủy** (not Received or Cancelled), both gated. Bulk action **Duyệt mục đã chọn**.
4. Detail drawer: supplier, site, expected date, notes, a line table (product, ordered, received, notes), and Approve and Cancel in the footer. History tab (US5, gap G18).
5. Create drawer: number (optional), expected date (optional), supplier and site (required), notes, and lines (product, ordered quantity, line notes). The draft autosave keeps text fields only, not lines.

**Goods receipts tab (`/receiving`)**

1. Header button **Nhận hàng** (key **N**), gated by `goodsReceipt.create`.
2. Search by receipt number, saved views, CSV export. Columns: Receipt number, Status, Site, Supplier, Received.
3. Detail drawer: supplier, site, received time, notes, and lines (product, batch, expiry, manufactured date, manufacturer, quantity, unit cost, notes). History tab (US5, gap G18).
4. Receive drawer: receipt number, supplier, site, storage location, optional purchase order picker (search by number, shows status), receipt date (US3, gap G16), notes, and lines. Today the drawer sends the browser's clock at submit, and the user cannot change it.

**Status labels.** Both statuses are staff-only; neither is shown to customers.

| Record | Status | Staff label |
| --- | --- | --- |
| Purchase order | Draft | Nháp |
| Purchase order | Approved | Đã duyệt |
| Purchase order | PartiallyReceived | Nhận một phần |
| Purchase order | Received | Đã nhận |
| Purchase order | Cancelled | Đã hủy |
| Goods receipt | Posted | Đã ghi nhận (neutral badge) |
| Batch quality | PendingQc / Released / Rejected | Chờ kiểm tra / Đã đạt / Từ chối |

**Not on these pages:** editing a receipt or deleting one. A wrong receipt is corrected by a stock adjustment that cites it, on [Inventory operations](staff-inventory-operations.md). Batch quality decisions are on [Quality](staff-quality.md).

## States

- `[observed]` Loading: the list shows its loading state. The detail drawer shows a skeleton until the detail loads.
- `[observed]` Error: a failed list shows a danger alert with the message. A failed action shows an error toast and changes nothing. A load error is never shown as an empty list.
- `[observed]` Empty: "Chưa có bản ghi" in both lists and in the drawer line tables.
- `[observed]` Bulk approve running: **Duyệt mục đã chọn** is disabled until the loop ends.
- `[observed]` No site access: the API answers 403 `site_access_denied` and the page shows the server's English title (gap G4). Target: a Vietnamese message saying the account has no site assigned.
- `[standard]` Signed out or a 401 from any request: the shell ends the session with a Vietnamese notice and returns the user here after sign-in.

## Out of scope

- Editing an order after approval (cancel and re-create instead).
- Partial cancellation as a separate action. Cancelling a partly received order cancels the rest only.
- Editing or deleting a receipt (see Contents).
- Supplier invoices and payments (finance).
- Quality decisions beyond Release and Reject.

## Rules and designs

- Business rules: [BR-PROC-001 to 006](../business-rules.md), [BR-RECV-001 to 008](../business-rules.md), [BR-QUALITY-001 to 004](../business-rules.md), [BR-INV-005](../business-rules.md), [BR-AUTH-002 to 004](../business-rules.md), [BR-AUDIT-001 to 003](../business-rules.md), [BR-EVT-001](../business-rules.md) (outbox in the same transaction). Rules for self-approval, Draft editing, expiry, batch identity and receipt dates do not exist yet; the gaps name them.
- [API guide, Procurement](../api-guide.md#procurement): the endpoints the pages call.
- [User guide, Purchasing and receiving](../user-guide.md#purchasing-and-receiving).
- [ADR 0002](../adr/0002-service-owned-databases.md): procurement tables belong to the inventory database.
- [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md): events go through the outbox.
- [Design 0001](../design/0001-operations-query-reads-only-events.md) (Draft): the receipt event and its payload.
- [Quality](staff-quality.md) and [Inventory operations](staff-inventory-operations.md): the stock side of a receipt.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Why are ordering and receiving two roles? | Keep the split. Pharmacy Manager orders and approves; Warehouse Staff records receipts; Platform Admin reads both and does neither (BR-AUTH-010). | `[standard]` Buyer and receiver are separate duties. A receipt confirms the order only when another person records it (three-way match of order, receipt and invoice). |
| 2 | Can the creator approve their own order? | No. Approval needs another Pharmacy Manager; Platform Admin approves nothing. Cancel needs no second person: it adds no stock or payment, so any Pharmacy Manager with site access may cancel. | `[standard]` Segregation of duties, ISO/IEC 27001 practice. Nobody checks their own purchase. Gap G1. |
| 3 | Should Warehouse Staff see purchase orders? | Yes, read-only, for their own sites. Writes stay with the Pharmacy Manager. Orders carry no prices. | `[standard]` Receiving checks lines against the order, so the receiver needs to see it. Least privilege keeps writes away. |
| 4 | Approved or PartiallyReceived for a linked receipt? | Both. The user guide is corrected to say so. | `[standard]` Suppliers deliver in parts. The order stays open until every line is complete (BR-RECV-007). |
| 5 | A product not on the order: which message? | Refuse with its own message, "Sản phẩm không có trên đơn đặt hàng này." | `[standard]` The fix differs. The warehouse checks the delivery note; it does not reduce a quantity. Gap G6. |
| 6 | Must a linked receipt match the order's supplier and site? | Yes. The supplier and site must equal the order's, and the storage location must belong to the receipt's site. | `[standard]` Three-way match. Stock placed at a site the order did not name breaks the purchase record. Gap G7. |
| 7 | A second expiry for the same batch number? | Refuse. A batch is product plus batch number and has one expiry. A different manufacturer, manufactured date or supplier is refused too, when given. | `[standard]` One lot, one expiry. Traceability needs one record per lot. Gap G8. |
| 8 | Accept an expired delivery? | No. Refuse an expiry date before today (Asia/Ho_Chi_Minh). Expiry today is accepted, and the batch stops being sellable after that day (BR-QUALITY-004). | `[standard]` Expired stock cannot be sold or dispensed. Receipt is the cheapest point to stop it. Gap G9. |
| 9 | Is stock written after the receipt commits? | No. One transaction covers the receipt, its lines, the order update, the batch, the movements and the event. There is no repair job: a failure saves nothing. | `[standard]` Documents and stock move together (BR-EVT-001, ADR 0003). A half-saved receipt cannot be repaired by a retry. Gap G11. |
| 10 | Is the receipt event planned for release? | Yes. Emit `procurement.goods-receipt.recorded.v1` through the outbox in the receipt transaction, with design 0001's payload. No event for purchase orders now. | `[standard]` Operations counts receipts from it (design 0001). No other service needs purchase-order state. Gap G13. |
| 11 | Is the Draft a fixed record? | No. A Draft is editable by a Pharmacy Manager with site access until approval. Approved and later orders are not editable; a change means cancel and re-create. A Draft is never deleted. | `[standard]` A typo is fixed without leaving a cancelled record. What was approved must match what is ordered. Gap G2. |
| 12 | Can the receipt date be back-dated? | Yes, up to 7 days. The date defaults to today (Asia/Ho_Chi_Minh). A future date is refused. The server stores the entered date with the submit time. | `[standard]` Late paperwork is common, and a short window keeps stock history honest. Owner may change: the window length is a policy choice. Gap G16. |
| 13 | Are numbers unique? | Yes, across the system. A duplicate is refused with 409 in Vietnamese. A generated purchase order number is retried if it collides. | `[standard]` The number identifies the document for search and audit (BR-AUDIT-002). The database already enforces uniqueness. Gap G15. |
| 14 | Must a receipt name an order? | No. The purchase order is optional. Supplier, site, location and every line rule still apply. | `[standard]` Some goods arrive without an order, such as free goods. Owner may change: requiring an approved order is a purchasing-control policy. |
| 15 | A receipt into a batch that is already reviewed? | A Released batch takes the new stock as sellable at once, because the lot has already passed review. A Rejected batch refuses the receipt. A PendingQc batch takes it and stays PendingQc. | `[standard]` A batch number is one lot, and release applies to the lot. Owner may change: a stricter quarantine per receipt would need a schema change. Gap G10. |
| 16 | Is the history tab for records a user can see? | Yes. Each purchase order and receipt has a History tab from an entity-scoped history. It is not the audit page, which stays Platform Admin only. | `[standard]` Entity history is shown to whoever can see the record. The full audit log is for the audit role. Gap G18. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | The creator of an order cannot approve it, from any route (Decision 2). | The rule is enforced in the action route (`refuseSelfApproval`, for the row, drawer, bulk and API), and `purchaseOrder.approve` is marked `separationOfDuties`. The refusal is 403 `self_approval_forbidden` with the English title "Approver must not be the creator", not the 409 and Vietnamese text US2 names. BR-PROC-005 is still silent. | `apps/inventory-service/src/modules/procurement-routes.ts` (action route); `apps/inventory-service/src/modules/access-control.ts` (`refuseSelfApproval`); `apps/staff-web/src/permissions/staff-permissions.ts` (`purchaseOrder.approve`); [business-rules.md §7](../business-rules.md) needs a rule. |
| G2 | A Draft can be edited until approval; other statuses cannot (US1a). | No edit route for purchase orders. The drawer is create-only. | `apps/inventory-service/src/modules/procurement-routes.ts`; [api-guide.md, Procurement](../api-guide.md#procurement) lists no edit route. |
| G4 | Reference failures answer 400 `invalid_reference` with a Vietnamese title. Access and error titles are Vietnamese (US1, States). | `assertCatalogReferences` throws a plain `Error`, so the handler answers 500 "Internal Server Error". "Catalog reference validation failed", "No site access assigned" and "Site access denied" have no entry in the procurement literals, so `translateText` shows English. | `procurement-routes.ts` (`assertCatalogReferences`); `apps/inventory-service/src/main.ts` (error handler); `apps/staff-web/src/i18n/procurement.ts`. |
| G6 | A product not on the order has its own message (Decision 5). | Same message as over-receipt, "Receipt exceeds ordered quantity", for both cases (`!orderLine \|\| …`). | `procurement-repository.ts` (`createReceipt`); `staff-web/src/i18n/procurement.ts`; [BR-RECV-004](../business-rules.md). |
| G7 | Supplier and site must equal the order's; the location must belong to the site (Decision 6). | No comparison. The catalog check confirms that the storage location exists, not that it belongs to the site. | `procurement-repository.ts` (`createReceipt`); `procurement-routes.ts` (`assertCatalogReferences`). |
| G8 | A batch's expiry, manufacturer, manufactured date and supplier must match when given (Decision 7). | The receipt handler reuses an existing batch with the same product and number and ignores the new fields. | `apps/inventory-service/src/main.ts` (procurement receive handler). |
| G9 | Expiry before today is refused (Decision 8). | `goodsReceiptLineSchema` checks only that `expiryDate` is a date. BR-RECV-003 has no date rule. | `apps/inventory-service/src/contracts/procurement.ts`; [business-rules.md §7](../business-rules.md) needs a rule. |
| G10 | A Rejected batch refuses a receipt. A Released batch takes sellable stock (Decision 15). | The handler and `recordMovement` do not read the batch's quality status. Stock is added to a Rejected batch. | `apps/inventory-service/src/main.ts`; `apps/inventory-service/src/modules/inventory-repository.ts` (`recordMovement`). |
| G11 | The receipt, order update, batch, movements and event share one transaction (Decision 9). | `createReceipt` commits the receipt and order first. Batches and movements are written afterwards, in separate calls. A failure leaves a receipt with no stock, and a retry hits the unique receipt number and answers 500. | `procurement-repository.ts` (`createReceipt`, after the transaction); `main.ts`. |
| G12 | Two concurrent receipts cannot both pass the over-receipt check (US3). | The check reads the order lines without a row lock. | `procurement-repository.ts` (`createReceipt`, the `orderedLines` read). |
| G13 | Event `procurement.goods-receipt.recorded.v1` in the outbox, in the same transaction, with design 0001's payload (Decision 10). | No event is written. `goodsReceiptPostedEventSchema` has `supplierId` and `lineCount`; design 0001 has `status` and no `lineCount`. Design 0001 is the plan, so the schema is the side to align. | `apps/inventory-service/src/contracts/procurement.ts`; [design 0001](../design/0001-operations-query-reads-only-events.md). |
| G14 | Quantities are whole numbers (US1, US3). | The contract accepts any positive number. The columns are `integer`, so a decimal fails in the database and answers 500. | `contracts/procurement.ts`; `apps/inventory-service/src/shared/infrastructure/schema.ts` (`orderedQuantity`, receipt line `quantity`). |
| G15 | Numbers are unique and a duplicate answers 409 in Vietnamese (Decision 13). | Unique indexes exist (`purchase_orders_number_unique`, `goods_receipts_number_unique`), but the duplicate reaches the handler as an unmapped error, so it answers 500. The generated number uses three random digits per second, so it can collide. | `schema.ts`; `procurement-routes.ts`; `procurement-repository.ts` (`createPurchaseOrder`). |
| G16 | The receiver enters the receipt date within the window (Decision 12). | The drawer sends `new Date().toISOString()` from the browser. The API accepts any datetime with an offset. | `apps/staff-web/src/sections/procurement/receive-goods-drawer.tsx`; `contracts/procurement.ts` (`receivedAt`). |
| G18 | A History tab on each purchase order and receipt, from an entity-scoped history (Decision 16, US5). | Neither drawer has a History tab. `EntityDrawer` supports one. `SalesAuditHistory` reads `/api/audit/logs`, which is Platform Admin only, so it cannot be reused here. No entity history route exists for procurement. | `apps/staff-web/src/sections/procurement/purchase-order-drawer.tsx`; `goods-receipt-drawer.tsx`; `apps/staff-web/src/components/entity-drawer.tsx`; `apps/staff-web/src/sections/sales/shared.tsx`; `policy.mjs` (`platformAdminPaths`). |

### US7. As a Warehouse Staff member, I record the purchase cost of received goods, so that Analytics can show real gross profit

- Source: `[owner]` 2026-10-29; rule `[standard]` (BR-PROC-009, BR-REPORT-009, [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md)).
- Accepted when:
  - Each receipt line has an optional field **Giá nhập (₫/đơn vị)**: the cost of one unit received, before VAT. The hint says to leave it blank when unknown.
  - A blank field is stored as no cost, never 0. A negative value, a value with more than 2 decimals, a comma and a value above 1 000 000 000 are refused with a message naming the line, before anything is sent; the server and the database refuse them too.
  - The receipt detail shows the cost per line, and "—" for a line that has none.
  - Test: receive a batch with a cost, sell some of it, and Analytics shows a gross profit for that sale; receive another batch without a cost, sell from it, and that sale adds nothing to gross profit.
