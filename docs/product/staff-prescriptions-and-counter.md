# Prescriptions and counter

- **Status:** Current
- **App and route:** staff-web, `/prescriptions`; tabs **Prescriptions**, **Counter transactions** and **Consultations** (`?tab=`). The dispense drawer opens at `?prescription=<id>`. `/pharmacist-overview` (sidebar **Tổng quan quầy**) opens this section on **Counter transactions**.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0016, 2026-10-26); `[observed]` read from the code on 2026-10-26; `[standard]` a decision from industry practice, listed under Decisions. See [README](README.md).

Code: `apps/staff-web/src/sections/prescriptions-section.tsx`, `sections/prescriptions/*`, `sections/sales/rules.ts`, `permissions/staff-permissions.ts`, `staff-api.ts`, `hooks/useStaffReferences.ts`. Services: `apps/sales-service/src/modules/sales-routes.ts`, `apps/sales-service/src/modules/prescriptions/presentation/prescription-consultation-routes.ts`, `apps/payment-service/src/modules/payment-routes.ts`, the `trusted-request.ts` of each service.

## Purpose

- The pharmacy counter's workspace. A pharmacist records a prescription for a patient (reserving stock), hands medicines out batch by batch (first-expired, first-out), takes payment at the counter, and answers shoppers' consultation requests. `[standard]` Clinical handover needs a licensed pharmacist; a Pharmacy Manager supervises read-only. `[observed]` `prescriptions-section.tsx` gives the same reason.
- `[owner]` Prescription-only products are not sold through the online cart. A customer gets them through **Gửi đơn thuốc**, a pharmacist's consultation, or the counter (ADR 0016). The counter route is this section.

## Users and entry points

- Staff only. Pharmacist: every action. Pharmacy Manager and Platform Admin: read-only (Decision 10). Warehouse Staff: no access.
- `[observed]` The sidebar items **Prescriptions** and **Pharmacist overview** show for Pharmacist and Pharmacy Manager; Platform Admin reads **Prescriptions** and has no **Pharmacist overview** (`App.tsx`, `sectionRoles`, BR-AUTH-010). A direct visit by a role without access opens that role's first section.
- Staff sign in with email and password ([staff shell](staff-shell-sign-in-and-navigation.md)). Shoppers do not use this page; their intake and consultation requests are in [customer-prescription-intake-page.md](customer-prescription-intake-page.md).

## User stories and acceptance criteria

### US1. As a pharmacist, I find a prescription in the queue, so that I can work on it

- Source: `[observed]` 2026-10-26.
- Accepted when:
  - **Prescriptions** lists the prescriptions of the caller's assigned sites (BR-AUTH-004; Platform Admin sees all), newest first, 100 per page, with **Load more**.
  - Status tabs **All**, **Pending**, **PartiallyDispensed**, **Dispensed**, **Cancelled** filter the list; **All** sends no status filter.
  - Search (`Tìm theo số đơn, tên bệnh nhân hoặc số điện thoại`) matches prescription number, patient name or phone. Export `prescriptions.csv`.

### US2. As a pharmacist, I open one prescription and read its lines

- Source: `[observed]` for the drawer; History `[standard]` (Decision 2).
- Accepted when:
  - **View** opens a drawer with patient, phone, doctor, doctor licence, site, created time, notes, and each line: product, **Kê** (prescribed), **Số lượng xuất** (dispensed), dosage, frequency and duration when set.
  - The **History** tab shows that prescription's events to every role that can open the drawer, from a record-scoped history, not the full audit log (gap G4).

### US3. As a pharmacist, I create a prescription and reserve its stock

- Source: `[observed]` BR-RX-000, BR-RX-002 to BR-RX-007, BR-RX-016, BR-USER-011.
- Accepted when:
  - **Tạo đơn thuốc** (header, or **N** with no drawer open) appears for a Pharmacist on the queue only.
  - Required: site (`Cơ sở`), storage location (`Vị trí lưu trữ`), patient name (`Tên bệnh nhân`), and at least one line with product, unit (`Đơn vị sản phẩm`) and quantity (default 1). Site and location lists show the caller's sites only (gap G6).
  - Submit sends `POST /api/prescriptions` with `Idempotency-Key`. The prescription is Pending and stock is reserved FEFO at the chosen location (BR-RX-005, BR-RX-006).
  - If stock cannot be reserved, no prescription remains (BR-RX-007) and the toast shows a Vietnamese reason (gap G3).
  - **Tìm khách hàng** with 3+ characters of an exact phone or email lists up to five active customer accounts; choosing one fills patient name and phone only where empty. Enter runs the lookup without submitting. Pharmacist only (BR-USER-011).
  - Patient details are kept on the device until created; the linked account and the lines are not.

### US4. As a pharmacist, I hand out medicines against a prescription, batch by batch

- Source: `[observed]` BR-RX-008 to BR-RX-013, BR-QUALITY-003, BR-QUALITY-004; batch choice `[standard]` (Decision 1).
- Accepted when:
  - **Xuất thuốc** appears on Pending and PartiallyDispensed rows and in the drawer footer only.
  - The drawer opens at `?prescription=<id>`, survives a refresh, and shows only lines with quantity due, each pre-filled with **Còn phải xuất**.
  - **Lô sản phẩm** lists only Released, unexpired batches of that product with available stock at the prescription's storage location, earliest expiry first, first pre-selected (gap G1). A Pharmacist can read them.
  - A quantity below 1 or above **Còn phải xuất** shows "Nhập số lượng từ 1 đến số còn phải xuất." and sends nothing.
  - Success: "Đã xuất đơn thuốc."; status PartiallyDispensed while lines remain, Dispensed when complete. A repeated request does not deduct twice (BR-RX-012).
  - A refusal (409 `dispense_rejected`) keeps the drawer open and shows the reason in Vietnamese (gap G3).

### US5. As a pharmacist, I cancel a prescription the shopper declines

- Source: `[observed]` BR-RX-014, BR-RX-015.
- Accepted when:
  - **Hủy đơn thuốc** appears on Pending and PartiallyDispensed rows (menu or drawer footer), not on Dispensed or Cancelled.
  - Confirmation "Hủy đơn thuốc này?": dismissing changes nothing; accepting shows "Đã hủy đơn thuốc.", sets Cancelled and releases the reservation.
  - A prescription is not edited after creation; a wrong one is cancelled and recreated, and both are audited `[standard]`.

### US6. As a pharmacist, I raise a counter invoice for a prescription

- Source: `[observed]` BR-PAY-001, BR-PRICE-008.
- Accepted when:
  - **Tạo hóa đơn** is on the Prescriptions tab (row or drawer) for every prescription except Cancelled, Dispensed included. It is not on Counter transactions (Decision 5).
  - The invoice is `sepay_qr` at each line's active price. A prescription with an invoice returns that invoice; no second one is created.
  - A line with no active price creates no invoice and the server answers 409 `product_unpriced` naming the product (gap G10). The server refuses a Cancelled prescription (gap G9).
  - Toast "Đã tạo hóa đơn quầy."; the invoice appears on **Giao dịch tại quầy** as Pending.

### US7. As a pharmacist, I confirm cash, read a QR payment and refund, so that the till matches the record

- Source: `[observed]` BR-PAY-002, BR-PAY-003, BR-PAY-007; `[standard]` Decisions 4, 5, 13, 15, 19.
- Accepted when:
  - **Giao dịch tại quầy** lists counter invoices only (no order) of the caller's sites, newest first. Default filter **Hôm nay** (Asia/Ho_Chi_Minh), clearable with **Tất cả ngày**. Status tabs All, Pending, Paid, Refunded, Failed, Cancelled; search by invoice number; export `counter-payments.csv` (gaps G11 to G13).
  - Opening a row shows amount, lines, invoice code (`PC-…`), status and, for a Pending QR invoice, the QR image, bank, account and transfer content from `GET /api/payments/invoices/{id}` (gap G14). A matching transfer marks the invoice Paid with no action here (BR-PAY-007).
  - **Xác nhận tiền mặt** only on Pending; accepted: "Đã xác nhận thanh toán tại quầy.", status Paid.
  - **Hoàn tiền** only on Paid. The reason (`Lý do hoàn tiền`) is required, empty by default, with "Tối đa 500 ký tự" shown (gap G15). Accepted: "Đã hoàn tiền.", status Refunded; the refund covers the whole invoice (BR-PAY-003).
  - Failed rows show the reason (for example, amount mismatch) with no action; Refunded and Cancelled rows have no action.

### US9. As a pharmacist, I answer a shopper's consultation request

- Source: `[observed]` BR-RX-020, BR-RX-021; `[standard]` Decisions 11, 12.
- Accepted when:
  - **Tư vấn** has tabs **Đang chờ** (Open, default; oldest first) and **Đã trả lời** (Answered; newest first) (gap G17).
  - Each card shows the store, sent time, source (**Mã QR** or **Ảnh**), prescription fields read, **Ghi chú của khách**, and each line; lines marked **Cần tìm thuốc** come first.
  - **Trả lời của dược sĩ** (at most 2000 characters) and **Gửi trả lời** are enabled only when the reply is not blank and no send is running. Only a Pharmacist sees them.
  - Success: "Đã gửi câu trả lời."; the card moves to Đã trả lời with "Trả lời lúc". A second answer shows "Dược sĩ khác đã trả lời yêu cầu này." and refreshes.
  - A pharmacist sees requests of assigned sites and unassigned requests (BR-AUTH-004). Each request has a **History** tab (gap G5).

### US10. As a Pharmacy Manager or Platform Admin, I read the counter records without changing them

- Source: `[observed]` BR-AUTH-002, BR-RX-000; `[standard]` Decision 10.
- Accepted when:
  - The queue, counter transactions and consultations load.
  - "Chỉ xem: xuất thuốc, thanh toán và trả lời tư vấn cần vai trò Dược sĩ." shows. No Create, Dispense, Cancel, Create invoice, Confirm cash, Refund or Send reply control is rendered; **N** does nothing; the customer lookup is not offered.

## Contents and behavior

- **Prescriptions**: the queue, **Tạo đơn thuốc**, the dispense drawer and row actions. A Pharmacist sees **View**, then **Xuất thuốc** on a dispensable row, or **Tạo hóa đơn** on an invoiceable row that cannot be dispensed; **Hủy đơn thuốc** and, beside **Xuất thuốc**, **Tạo hóa đơn** sit in **Thao tác khác**. `[observed]`
- **Counter transactions** (US7, no create action); **Consultations** (US9).
- Labels: one staff and one customer label per status (Decision 6).

| Object | Value | Staff label | Customer label |
| --- | --- | --- | --- |
| Prescription | Pending | Chờ xử lý | Chờ xử lý |
| Prescription | PartiallyDispensed | Cấp phát một phần | Đã lấy một phần |
| Prescription | Dispensed | Đã cấp phát | Đã lấy đủ |
| Prescription | Cancelled | Đã hủy | Đã hủy |
| Consultation | Open | Đang chờ | Đang chờ dược sĩ |
| Consultation | Answered | Đã trả lời | Dược sĩ đã trả lời |
| Counter invoice | Pending, Paid, Refunded, Failed, Cancelled | Chờ xử lý, Đã thanh toán, Đã hoàn tiền, Thất bại, Đã hủy | Not shown to shoppers here |
| Online order | Preparing | Đang soạn | Đang lấy thuốc |

## States

- Loading: the table loading state; consultations show "Đang tải yêu cầu tư vấn…".
- Failure: a Vietnamese error alert. A failed load never shows empty-state text (gap G19).
- Empty: "Chưa có thanh toán tại quầy." (counter), "Không có yêu cầu tư vấn nào." (consultations).
- Dispense drawer: "Đơn thuốc này không thể xuất ở trạng thái hiện tại." when the status does not allow it; "Mọi dòng của đơn thuốc này đã được xuất đủ." when every line is complete.
- Create form: a refused create shows a toast with the reason and keeps the entered values.
- Session: a 401 ends the session with a Vietnamese notice and returns to sign-in, then back to this page (staff shell spec).
- Role without access: the section is hidden and the shell opens the role's first section.

## Out of scope

- Shopper intake, consultation requests and the customer **Đơn thuốc** tab (customer-web).
- Online orders, their status changes and their payment panel ([staff-online-orders.md](staff-online-orders.md)).
- Editing a prescription after creation (US5); partial refunds (BR-PAY-003).
- Printing invoices: the API has the route; this section has no action for it.
- Receiving, quality release, adjustments and transfers ([staff-inventory-operations.md](staff-inventory-operations.md), [staff-quality.md](staff-quality.md)).
- The Finance **Invoices** tab ([staff-finance.md](staff-finance.md)), where Failed payments are reconciled (Decision 19).
- Counter sale of non-prescription products by SKU or barcode (the **Bán tại quầy** tab): planned, not built: BR-RX-000A and BR-RX-000B already define it; this spec does not require it yet. `[owner]` 2026-10-26.

## Rules and designs

- Business rules in [business-rules.md](../business-rules.md): BR-AUTH-002, BR-AUTH-004, BR-USER-011, BR-RX-000, BR-RX-000A, BR-RX-000B, BR-RX-002 to BR-RX-018, BR-RX-020, BR-RX-021, BR-PAY-001 to BR-PAY-003, BR-PAY-007, BR-PAY-008, BR-PRICE-008, BR-INV-007, BR-QUALITY-003, BR-QUALITY-004, BR-FIN-003, BR-AUDIT-004, BR-ORD-011.
- [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): the counter is one route for prescription-only products.
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices and stock are the server's; the screen computes neither.
- [API guide, Staff sales and inventory](../api-guide.md#staff-sales-and-inventory); [Prescription consultations](../api-guide.md#prescription-consultations).
- [User guide, Prescriptions and counter](../user-guide.md#prescriptions-and-counter).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Which batches may a dispense pick, and who reads them? | Released, unexpired batches of the line's product with available stock at the prescription's storage location, earliest expiry first. A Pharmacist reads batches and stock of assigned sites; only Warehouse Staff change them. `[standard]` | FEFO and quality gates (BR-RX-011, BR-QUALITY-003, BR-QUALITY-004) need location and expiry at handover. Reading stock is needed to dispense; writing it is not a pharmacist task. |
| 2 | Who sees the History tab, and from what? | Anyone who can open a record sees its History, from events scoped to that record. The full audit log stays Platform Admin only. `[standard]` | Record readers need their own record's history; the full log exposes other records and sites (least privilege, audit per PCI DSS v4 Req. 10.5.1). |
| 4 | How does a counter QR payment reach the till? | The invoice drawer shows the QR image, bank, account, amount and transfer content from the invoice's payment instruction. A matching transfer marks the invoice Paid (BR-PAY-007). Only cash is confirmed by hand. `[standard]` | The customer pays from a bank app using the code in the transfer content. Hand confirmation of transfers invites error and fraud. |
| 5 | Which list is Counter transactions, and where is Create invoice? | Counter transactions lists counter invoices (no order) of assigned sites, today by default, with a detail drawer and no create action. Create invoice is on the prescription. `GET /api/counter-transactions` is retired: it returns prescription rows, duplicating `/api/prescriptions`. `[standard]` | The till reconciles payments, not prescriptions. One route per concept; the user guide and API guide are corrected. |
| 6 | Which label goes with which state? | The label table under Contents. Staff keep "Cấp phát" and "Đang soạn". Customers see collection wording: "Đã lấy một phần", "Đã lấy đủ", "Đã hủy", and "Đang lấy thuốc" for Preparing. `[standard]` | Customers collect medicine, and "Đang lấy thuốc" is the project's label. "Đã bán" would describe a sale the counter records. "Đã hủy" is the single spelling. Wording, not policy. |
| 7 | Are prescription-only products restricted at the counter? | A prescription-only product leaves the counter only on a prescription (US3) or a pharmacist's consultation answer, never on a staff-entered invoice or a counter sale (see Out of scope). Other products may appear on a prescription. `[standard]` | ADR 0016 names the counter as a route; the prescription is the record that makes the handover lawful. Owner may change. |
| 8 | Is Draft still used? | No. Draft is retired. New prescriptions are Pending (BR-RX-005). Existing Draft rows, if any, move to Pending in a one-time data fix before the value is removed. `[standard]` | No screen creates or filters Draft; it is a dead state with an untested cancel path. |
| 9 | What is the page's name? | "Prescriptions and counter" (sidebar **Đơn thuốc**; overview **Tổng quan quầy**). The user guide title "Prescriptions and counter sales" is changed to match. `[standard]` | Matches the sidebar and route. A naming fix only. |
| 10 | What may Platform Admin do here? | Read only, as Pharmacy Manager: it opens **Prescriptions** and not the Pharmacist overview. No create, dispense, cancel, invoice, cash, refund or reply. `[standard]` | Clinical and cash acts belong to the licensed pharmacist; Platform Admin's duties are platform, audit and access (least privilege, BR-AUTH-010). Owner may change. |
| 11 | Queue order and labels for consultations? | Open is oldest first, labelled "Đang chờ". Answered is newest first, labelled "Đã trả lời". `[standard]` | First come, first answered: an older request must not wait behind newer ones. |
| 12 | Does a consultation have a History? | Yes, under the rule of 2. The user guide's line on consultations becomes true. `[standard]` | Same record-reader rule as prescriptions. |
| 13 | How is a refund reason entered? | Required, 1 to 500 characters, empty by default, with the limit shown. Refunds need no second approver. `[standard]` | The reason is the audit record. The pharmacist who took the cash must reverse it at the till; the audit log holds actor and reason. Owner may change. |
| 14 | What happens to a line with no active price? | No invoice. The server answers 409 `product_unpriced` with the product id; the price is set first. `[standard]` | BR-FIN-003: a missing price is never guessed. |
| 15 | Which site does a counter invoice belong to? | The site of its prescription or counter sale, stored on the invoice; the list is narrowed to the caller's sites. `[standard]` | Site scope applies to every list (BR-AUTH-004); invoices carry no site today. |
| 19 | What happens to a Failed counter payment? | A read-only row showing the reason (BR-PAY-007 amount mismatch). The Pharmacy Manager resolves it in Finance reconciliation; a pharmacist cannot override it. `[standard]` | A bank mismatch needs a second look, and reconciliation is a manager's task. Owner may change. |
| 20 | Are actions by record id checked against sites before any write? | Yes. A record outside the caller's sites is refused with 403 `site_access_denied` before anything is written. `[standard]` | BR-AUTH-004. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Batch picker: Released, unexpired, stock at the prescription's location, FEFO. | Keeps Released, unexpired batches of the product. Location and stock are ignored, and no batch is pre-selected (`openDispenseLines` leaves `productBatchId` empty). The server returns batches in expiry order. | `sections/sales/rules.ts` (`dispensableBatches`); `hooks/useStaffReferences.ts` |
| G3 | Refusals in Vietnamese; the English reason stays in logs. | Dispense 409 `detail` and stock 409 `detail` carry English inventory text; the drawer and create form show it unchanged. | `sales-routes.ts` (dispense route, `reservePrescriptionStock`); `staff-api.ts` |
| G4 | History of a record for its readers, from a record-scoped history; the Audit page stays Platform Admin only (Decision 2). | History calls `/api/audit/logs`, Platform Admin only; Pharmacist and Pharmacy Manager get an error. BR-AUDIT-004 has no record-scoped rule. | `sections/sales/shared.tsx` (`SalesAuditHistory`); `trusted-request.ts`; `business-rules.md` BR-AUDIT-004 |
| G5 | Consultation History tab (Decision 12). | No consultation drawer or History. The user guide's "Details drawer" bullet says consultations have one; build it or correct the guide. | `consultations-tab.tsx`; `user-guide.md` "Working with lists" |
| G6 | Site and location selectors list assigned sites only. | `/api/sites` is not site-scoped (catalog-service `DEFAULT_SITE_SCOPED_PREFIXES` has no `/sites`); the create form lists every site. Locations are scoped. | `sections/prescriptions/create-drawer.tsx`; catalog-service `trusted-request.ts` |
| G8 | Draft retired (Decision 8). | Draft is valid in `prescriptionStatuses`, `canCancelPrescription`, BR-RX-008 and BR-RX-014; nothing creates it. | `sales-routes.ts`; `sections/sales/rules.ts`; `business-rules.md` BR-RX-008, BR-RX-014 |
| G9 | The server refuses an invoice for a Cancelled prescription. | `POST /api/payments/prescriptions/:id` invoices any status; only the UI hides the action. | `apps/payment-service/src/modules/payment-routes.ts` |
| G10 | No invoice for an unpriced line; 409 `product_unpriced` with the product id (Decision 14). | Throws a plain Error (`Prescription catalog price is unavailable`), so the answer is a generic 500. No invoice is created. | `payment-routes.ts` (prescription invoice route) |
| G11 | Counter list filtered on the server to counter invoices. | The client filters each page (`isCounterInvoice`), so a page can be empty while more follow; `listInvoices` has no counter filter. | `sections/prescriptions/counter-tab.tsx`; `payment-repository.ts` (`listInvoices`) |
| G12 | Counter invoices carry a site and the list is narrowed to assigned sites (Decision 15). | Payment invoices have no site; `listInvoices` takes no site; payment-service site scope has no `/payments` prefix. | `payment-repository.ts`; payment-service `trusted-request.ts`; `business-rules.md` BR-RX-017 |
| G13 | Today by default, with **Tất cả ngày**; invoice drawer (BR-RX-018). | No day filter and no invoice drawer. | `counter-tab.tsx`; `business-rules.md` BR-RX-018 |
| G14 | Invoice drawer shows the QR image, bank, account, amount and transfer content for a Pending QR invoice. | Only `paymentCode` in the Invoice column. The detail route returns `paymentInstruction` (`qrImageUrl`, `transferContent`), which nothing renders. | `counter-tab.tsx`; `payment-repository.ts` (`createPaymentInstruction`) |
| G15 | Refund reason empty by default, with the 500 limit shown (Decision 13). | The prompt pre-fills English "Customer request" and shows no limit. The server accepts 1 to 500. | `counter-tab.tsx` (`prompt`); `payment-routes.ts` (refund route) |
| G16 | Counter transactions is the invoice list; `GET /api/counter-transactions` is retired (Decision 5); the user guide places Create invoice on Counter transactions and calls the page "Prescriptions and counter sales" (Decision 9). | The route returns prescription rows (`listCounterTransactions` calls `listPrescriptions`) and has no staff-web caller. The API guide documents it as prescription rows. The user guide's Prescriptions and counter table and counter flow step 3 place Create invoice on Counter transactions. | `sales-routes.ts`; `api-guide.md` (`GET /api/counter-transactions`); `user-guide.md` "Prescriptions and counter"; `business-rules.md` BR-RX-017, BR-RX-018 |
| G17 | Open oldest first, Answered newest first (Decision 11). | Both tabs newest first (`desc(createdAt)`). The API guide says newest first; the comment in `consultations-tab.tsx` says oldest first. | `prescription-consultation-repository.ts`; `api-guide.md` "Prescription consultations"; `consultations-tab.tsx` |
| G18 | Open labelled "Đang chờ". | The raw value "Open" is shown. "Đang chờ" (`Waiting for answer`) exists in `i18n/sales.ts` but is unused. | `consultations-tab.tsx` |
| G19 | A load failure never shows empty-state text. | Consultations show "Không có yêu cầu tư vấn nào." when rows are empty, even on error; the counter tab shows its empty text beside the error. | `consultations-tab.tsx`; `counter-tab.tsx` |
| G20 | Customer labels per Decision 6, spelled "Đã hủy". | Customer-web shows "Đã bán một phần", "Đã bán đủ" and "Đã huỷ"; other customer pages also write "Đã huỷ". | `customer-web` `components/account/PrescriptionsCard.tsx`; `storefront/order-status.ts`; `components/checkout/OrderHistory.tsx`; `pages/AccountPage.tsx` |
| G21 | Staff invoices refuse prescription-only lines and take prices from the server (Decision 7). | The staff branch of `POST /api/payments/invoices` prices lines as sent and never reads `prescriptionRequired`. BR-PAY-008 says staff lines are kept as sent. | `payment-routes.ts`; `business-rules.md` BR-PAY-008 |
| G25 | One Vietnamese label for PartiallyDispensed: "Cấp phát một phần". | Two values: "Cấp phát một phần" (`i18n/procurement.ts`, the one the table shows) and "Xuất một phần" (`i18n.ts`, `prescription.status.PartiallyDispensed`, no caller). | `apps/staff-web/src/i18n/procurement.ts`; `apps/staff-web/src/i18n.ts` |
