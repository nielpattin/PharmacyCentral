# Online orders (staff)

- **Status:** Current
- **App and route:** staff-web, `/orders` (sidebar item **Online orders**)
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact, read on 2026-10-26; `[owner]` a recorded owner decision (Decision 14, 2026-10-26); `[standard]` a decision from industry practice, reasoned in [Decisions](#decisions). `(gap Gn)` marks a target the code does not meet yet; see [Gaps](#gaps-against-the-code-2026-10-26). The shared rules D1 to D16 apply and are cited by number: D1 segregation of duties, D2 roles, D3 site scope, D4 entity history, D5 passwords, D6 sessions, D7 storefront and lists, D8 prescription-only, D9 sign-in, D10 audit, D11 destructive actions and imports, D12 inventory, D13 counter and payments, D14 dashboards and real data, D15 status vocabulary, D16 accessibility and language.

## Purpose

- The screen where the pharmacy works the online orders that shoppers place on the customer site: it finds an order, shows what to hand over and where it goes, moves it through its states, and refunds or cancels it when it cannot be fulfilled.
- `[observed]` Today the screen is view-only: it lists orders newest first and opens one order to show store, fulfillment, payment, total and placed time (`apps/staff-web/src/sections/orders-section.tsx`). The [user guide](../user-guide.md#online-orders) says the same. No doc records why. The target replaces that design: staff must act on orders at the counter, and the decisions below say how (Decisions 1, 4, 13).

## Users and entry points

- Pharmacist and Pharmacy Manager work the screen; Platform Admin reads it and moves nothing (BR-AUTH-010). Warehouse Staff do not see it and cannot open `/orders` (`sectionRoles` in `apps/staff-web/src/permissions/section-access.ts`, `[observed]`).
- Staff sign in with a password (D9). Each staff member sees only orders at their assigned sites (D3, `(gap G12)`).
- Entry: the sidebar item **Online orders**, then the row action **View**. The open order is in the URL as `?order=<id>` (target, `(gap G14)`); today the drawer state is local and a reload closes it.

## User stories and acceptance criteria

### US1. As a pharmacist, I find an order by its code, so that I can check it

- Source: `[observed]`, search by order id only (Decision 16).
- Accepted when:
  - The search box is labelled **Tìm theo mã đơn hàng** and matches the first eight characters of the order id, shown as `#XXXXXXXX`; the query is written to the URL as `q`.
  - Pressing `/` focuses the search box.
  - Searching by customer name or phone is not offered.

### US2. As a pharmacist, I filter orders by status, so that I see the queue I work on

- Source: `[observed]`.
- Accepted when:
  - The tabs are **All**, **Pending**, **Confirmed**, **Preparing**, **Ready**, **Delivering**, **Completed**, **Cancelled**, in that order, and the choice is in the URL as `status`. **All** sends no status filter.
  - Tab and badge labels follow the vocabulary table in Contents (`(gap G15)` for Ready and Pending).
  - Rows are newest first, 100 per page, with **Load more** while another page exists.

### US3. As a pharmacist, I see what to hand over and where it goes, so that I can fulfil the order

- Source: `[observed]` for the list; `[standard]` for the drawer.
- Accepted when:
  - The list shows fulfillment, payment status, and total; total is the subtotal plus the delivery fee.
  - The drawer shows the order's lines (product name, unit, quantity, unit price, line total, from the price taken when the order was placed) `(gap G10)`.
  - For a delivery: the delivery address, address note, distance, duration, fee and the route on a map. If the map cannot load (no WebGL), an unavailable message replaces it and the page does not fail `(gap G10)`.
  - For a pickup: the store to collect from, and no delivery block.
  - The customer's name and phone number show to Pharmacist and Pharmacy Manager for orders at their assigned sites, and to Platform Admin for every order (Decision 14). Warehouse Staff see neither, and cannot open the screen anyway `(gap G11)`.
  - Every time shows in Asia/Ho_Chi_Minh `(gap G16)`.

### US4. As a pharmacist, I move an order to its next state, so that the shopper gets it

- Source: `[standard]` for the actions (Decisions 1 to 3, 6 to 8, 10); `[observed]` for the server transitions it builds on.
- Accepted when:
  - The drawer shows only the actions the status and fulfillment allow (Contents). An action the server would refuse is not shown.
  - A move the server refuses shows a Vietnamese message from the server, and the status does not change.
  - A pickup order never goes to `Delivering`; a delivery order goes `Ready` → `Delivering` → `Completed`; a `Ready` order can be cancelled while unpaid.
  - A COD order cannot be completed until its cash is recorded as received.
  - Staff cannot cancel an order that is paid; the paid order is cancelled by a refund (US5).
  - A Warehouse Staff user gets 403 on every move, on the screen and at the API.
  - Each move is written to the order's history with the signed-in actor (US7).

### US5. As a Pharmacy Manager, I refund an online order before handover, so that the money returns and the order is cancelled

- Source: `[standard]` (Decisions 4 to 6).
- Accepted when:
  - **Hoàn tiền và hủy đơn** shows only for a paid order in `Pending`, `Confirmed`, `Preparing` or `Ready`. It asks for a reason with the prompt **Lý do hoàn tiền là gì?**, 1 to 500 characters, with the limit shown in the form (D13).
  - After the refund: payment status `Refunded`, order `Cancelled`, stock hold released (BR-ORD-010).
  - A Pharmacist and a Platform Admin see no refund action on this screen, and the server refuses both `(gap G5)`.
  - After `Delivering` or `Completed` no refund action shows, and the server refuses a refund `(gap G6)`.

### US6. As a staff member, I see only the orders of my sites, so that another pharmacy's orders stay out of view

- Source: `[standard]` (D3, BR-AUTH-004).
- Accepted when:
  - Pharmacist and Pharmacy Manager see only orders whose store is one of their assigned sites; with no assigned site they see a message, not an empty list `(gap G12)`.
  - The store filter offers only the assigned sites `(gap G12)`.
  - Platform Admin sees every store.
  - Opening an order at another site returns 404.

### US7. As a staff member, I read an order's history, so that I know who changed it and when

- Source: `[standard]` (D4).
- Accepted when:
  - The **History** tab lists only this order's events: time, action, and the actor's name; a change with no person behind it (the expiry sweep, the payment webhook) shows **Hệ thống**. Every role that can open the order can read it `(gap G13)`.
  - The full audit log stays Platform Admin only and read-only (BR-AUDIT-004).

## Contents and behavior

`[observed]` unless marked `[standard]` or target.

**Header.** The status tabs (US2), the search box, the saved-views menu (key `orders`), and **Export CSV**. The export is named `online-orders.csv` and holds the visible columns. It holds only the rows loaded so far `(gap G17)`; the target is every matching order.

**Table columns:** Order (`#` plus the first eight characters of the id), Store, Fulfillment, Status (badge), Payment (text), Total, Placed, and the row action **View**. Store, Fulfillment, Payment and Placed hide on narrow screens. Sorting is off for the action column.

**Vocabulary (target, D15).** Each order status has one staff label and one customer label. Customer labels are the ones shown on the customer site (project decision: `Preparing` reads "Đang lấy thuốc").

| Status | Staff label | Customer label | Actions on this screen (target) |
| --- | --- | --- | --- |
| Pending | Chờ xác nhận | Chờ xác nhận | COD only: **Xác nhận đơn**. Any unpaid: **Hủy đơn**. A QR order is confirmed by its payment, not by staff |
| Confirmed | Đã xác nhận | Đã xác nhận | **Bắt đầu soạn**; **Hủy đơn** if unpaid; refund if paid (Pharmacy Manager) |
| Preparing | Đang soạn | Đang lấy thuốc | **Sẵn sàng** (pick complete); **Hủy đơn** if unpaid; refund if paid |
| Ready | Sẵn sàng | Sẵn sàng nhận hàng | Pickup: **Hoàn tất**. Delivery: **Giao hàng**. **Hủy đơn** if unpaid; refund if paid |
| Delivering | Đang giao | Đang giao hàng | **Hoàn tất** (after the COD cash is recorded). No cancel |
| Completed | Hoàn tất | Hoàn tất | None |
| Cancelled | Đã hủy | Đã hủy | None |

Payment status (`paymentStatus`): `Pending` reads **Chờ thanh toán** (staff) and **Chưa thanh toán** (customer); `Paid` reads **Đã thanh toán** in both; `Failed` reads **Thất bại** and **Thanh toán lỗi**; `Refunded` reads **Đã hoàn tiền** in both. `(gap G15)`

**COD cash.** For a COD order the drawer shows **Xác nhận đã thu tiền** while the payment is `Pending`. It records the cash through the payment route for a Pharmacist (BR-PAY-002). The order can then move to `Completed`.

**Flagged orders.** When a batch the order reserved is rejected in quality review, the order shows the badge **Cần chọn lại lô** and cannot move past `Preparing` until a Pharmacist picks it again with **Chọn lại lô** `(gap G18)`.

**Order drawer.** Title `#<code>`, subtitle **Đơn hàng online**, the status badge, and the actions above in its footer. Two tabs: **Details** (store, fulfillment, payment, total, placed, customer, lines, delivery) and **History** (US7). Details come from `GET /api/orders/{id}` when it opens `(gap G9)`; today it reuses the list row and shows five fields.

**Customer.** Name and phone come from the customer account (identity-service), read on the server only for Pharmacist and Pharmacy Manager at their assigned sites, and for Platform Admin everywhere `(gap G11)`. The order stores no contact.

**Real data.** Every row, figure, line and history entry comes from the server. A failed read shows the error, never zeros or sample rows `[observed]`.

## States

- **Loading and empty:** the table's loading state, and its empty state for the current tab and search `[observed]`.
- **Error:** an alert with a Vietnamese message above the table; no rows `[observed]`. An error in the History tab is an alert in that tab.
- **Failed move or refund:** the server's Vietnamese message in an alert; the status does not change; the row refreshes.
- **No assigned site:** a message that the account has no store assigned (`(gap G12)`).
- **Session ended (401):** the notice **Phiên đã hết hạn. Vui lòng đăng nhập lại.**, the user lands on sign-in, and returns to the same order after signing in `(gap G19)`.
- **Signed out:** the staff sign-in is shown; the screen makes no request `[observed]`.
- **Map unavailable:** an unavailable-map message in place of the route map `(gap G10)`.

## Out of scope

- Editing an order's lines, quantities, address or fee. A shopper may cancel only an unpaid order (BR-ORD-008).
- Refunding or taking back medicine after handover. Wrong or defective goods go through a warehouse return (BR-RET).
- Counter sales and counter invoices (Prescriptions page).
- Prescription-only products. They are never in an online order (BR-ORD-011, ADR 0016).
- Courier dispatch and route planning. The screen shows the route; it does not assign a courier.
- Customer accounts: profile, password and sign-in.

## Rules and designs

- Business rules: [BR-ORD-001 to BR-ORD-011](../business-rules.md) (order, status chain, stock, expiry, refund), [BR-DLV-001 to BR-DLV-008](../business-rules.md) (delivery route, fee, address), [BR-PAY-002 and BR-PAY-003](../business-rules.md) (cash confirmation, refund), [BR-PAY-009](../business-rules.md) (invoice read), [BR-AUTH-002, BR-AUTH-004, BR-AUTH-005](../business-rules.md) (roles, sites, actor), [BR-USER-011](../business-rules.md) (customer lookup), [BR-AUDIT-001, BR-AUDIT-004](../business-rules.md) (audit source and access), [BR-RET](../business-rules.md) (returns), [BR-QUALITY-002 to BR-QUALITY-004](../business-rules.md) (batch decisions).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices, stock and fees are the server's; the screen shows what the server stored.
- [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): prescription-only products are not sold online.
- [Customer orders page](customer-orders-page.md): the shopper's side of the same orders.
- [API guide](../api-guide.md): `GET /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/transition`, `POST /api/payments/{id}/refund`.
- No approval step is on this page, so D1 applies to its actions as the actor rule: every move, cash record and refund is recorded with the signed-in actor (BR-AUTH-005).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Who moves an order through its states, and where? | Pharmacist and Pharmacy Manager, from the order drawer. Platform Admin reads the drawer and moves nothing (BR-AUTH-010). Warehouse Staff cannot. `[standard]` | D2 fixed choice. The pharmacy hands over online orders at the counter. The server must enforce it too. |
| 2 | Which staff roles may move an order? | The same as 1. The API checks the role; the edge does not decide it alone. `[standard]` | Least privilege (D2). |
| 3 | Who confirms a paid order? | The system. When the invoice is `Paid`, a `Pending` order becomes `Confirmed`, as the code does. Staff confirm only a `Pending` COD order. BR-ORD-006 is corrected to match. `[standard]` | Payment is the confirmation; a second manual step on a paid order adds nothing. A COD order has no payment at placement, so staff accept it (G7). |
| 4 | Who refunds an online order? | Pharmacy Manager only, from the drawer, with a reason, before handover only. A Pharmacist and a Platform Admin cannot refund an online order. `[standard]` | D2 fixed choice. Medicine handed over is not restocked, and stock leaves the shelf at handover (BR-ORD-007). Owner may change (refund policy). |
| 5 | Can a Ready order be refunded? | Yes. It is cancelled and its hold is released. `[standard]` | Ready is before handover (D2): the goods are still on the shelf. Today Ready is left alone (G6). Owner may change (refund policy). |
| 6 | Can a paid order be cancelled directly? | No. A paid order is cancelled by the refund in 4, so money and goods move together. The server refuses a staff cancel of a paid order. `[standard]` | BR-ORD-010 is the only path that keeps payment and stock in step; today a paid cancel only logs an error (G4). |
| 7 | Who may cancel, and when? | Pharmacist and Pharmacy Manager, for an unpaid order in `Pending`, `Confirmed`, `Preparing` or `Ready`; Platform Admin cancels nothing (BR-AUTH-010). `[standard]` | D2: cancel before handover. Ready is added, which changes BR-ORD-005 (G3). |
| 8 | When is COD cash recorded? | At handover. The Pharmacist records the cash with **Xác nhận đã thu tiền**, then completes the order. A COD order cannot complete while unpaid. `[standard]` | Cash reconciles at handover; the cash is taken in the handover step, which is a counter action (D2). Without it an unpaid COD order is swept after 24 hours (BR-ORD-009) (G8). |
| 9 | Does a COD order need staff confirmation? | Yes: the Pharmacist presses **Xác nhận đơn** once the order can be filled. `[standard]` | The COD order is unpaid when placed, so staff are the only ones who accept it. |
| 10 | What are the fulfillment paths? | Pickup: `Ready` → `Completed`. Delivery: `Ready` → `Delivering` → `Completed`. `[standard]` | `Delivering` means the goods left the store; a pickup cannot leave. Today the state machine allows both paths for either fulfillment (G3). |
| 11 | Should staff see orders from every store? | No. Pharmacist and Pharmacy Manager see their assigned sites; Platform Admin sees all. `[standard]` | D3 and BR-AUTH-004. The screen still has no store filter (G12). |
| 12 | Can staff read one order's detail? | Yes, for orders at their sites. The drawer reads it from the server. `[standard]` | Lines, address and fee come from the server (ADR 0004). Today the drawer does not read the detail route (G9). |
| 13 | Who reads the History tab? | Every role that can open the order, from an entity-scoped history. The full audit log stays Platform Admin only. `[standard]` | D4. The tab calls the full audit log today, so Pharmacist and Pharmacy Manager get an error (G13). |
| 14 | Who sees the customer's name and phone? | Pharmacist and Pharmacy Manager for orders at their assigned sites; Platform Admin for every order, since it has no site limit. Warehouse Staff do not see them. `[owner]` 2026-10-26 | Owner decision. Contact is needed to hand over and deliver orders at the sites where the staff member works. Staff outside the order's site see nothing (D3). The customer lookup in BR-USER-011 is a separate rule. |
| 15 | Whose phone does the courier call? | The phone on the customer account. The order stores no separate recipient phone, and this page does not add one. If the account has none, the drawer shows **Chưa có số điện thoại**. `[standard]` | A recipient field at checkout would change the customer page, which this spec does not do. |
| 16 | Can staff search by customer? | No, by order code only. `[standard]` | The contact lives in identity-service. Joining it into every row spreads personal data to all list users. |
| 17 | Where does the open order live? | In the URL, `?order=<id>`, as the Prescriptions page does. `[standard]` | A reload or a shared link keeps the drawer open. Only the id is in the URL. Today it is local state (G14). |
| 18 | Which Vietnamese label does `Ready` get? | Staff **Sẵn sàng**; customer **Sẵn sàng nhận hàng** (Contents table). `[standard]` | One word per state across the two sites (D15). Today `Ready` has no staff label (G15). |
| 19 | Why is the screen view-only? | No valid reason; it is replaced. Staff act on orders at the counter. `[standard]` | D2 and D4 (Purpose). |
| 20 | Is the screen real-data only? | Yes. No sample rows; errors show as errors. `[standard]` | D14. Project decision for admin screens; not recorded in `docs/`. |
| 21 | Which time zone? | Asia/Ho_Chi_Minh for every time. `[standard]` | D7. Today the browser's zone is used (G16). |
| 22 | Does the export hold every order? | Yes: the export fetches every matching page before it saves. `[standard]` | D7 and D10: a partial file that looks complete is a silent cap (G17). |
| 23 | What does a rejected batch do to its orders? | The reservation of the rejected batch is released, the order is flagged **Cần chọn lại lô**, and a Pharmacist picks it again. `[standard]` | D12. The shopper is not asked to reorder while stock can still fill the order. Today nothing happens to the order (G18). |
| 24 | What does a 401 do? | The session ends visibly with the notice, and the user returns to the order after sign-in. `[standard]` | D6. The return to the order needs the open order in the URL (G14). |
| 25 | Which system name does the history show for automatic changes? | **Hệ thống**. `[standard]` | The user guide already says "System"; the UI shows the Vietnamese word. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G5 | Refund on the order drawer for a Pharmacy Manager, reason 1 to 500; Pharmacist and Platform Admin refused for online orders | Done in the drawer (**Hoàn tiền và hủy đơn**) and on Finance Invoices for online invoices only; the server refuses the other roles (`refundRefusal`). | `apps/staff-web/src/sections/sales/order-actions.tsx`; `apps/payment-service/src/modules/payment-access.ts` |
| G6 | Refund refused after `Delivering` or `Completed` | The drawer offers no refund after `Pending`..`Ready`, and `cancelRefunded` cancels `Ready` as well. The payment route still accepts any `Paid` invoice, because payment-service does not know the order status | `apps/sales-service/src/modules/orders/application/order-stock.ts`; `apps/payment-service/src/modules/payment-routes.ts` |
| G9 | Staff read any order at their sites through `GET /api/orders/{id}`, and the drawer reads its details from the server | The route answers staff for an order at one of their sites and `404` otherwise. The drawer does not call it and shows the list row. The [API guide](../api-guide.md) names only the other-customer `404`: align it after the change | `apps/sales-service/src/modules/sales-routes.ts` (`GET /orders/:id`); `apps/staff-web/src/sections/orders-section.tsx`; `docs/api-guide.md` |
| G10 | Lines, delivery address, note, distance, duration, fee, route map; unavailable message without WebGL | Drawer has five fields (Store, Fulfillment, Payment, Total, Placed). `getOrder` returns the delivery snapshot (`orderDeliverySnapshots`), but no screen reads it. staff-web has no map library | `apps/staff-web/src/sections/orders-section.tsx`; `apps/sales-service/src/modules/sales-repository.ts` (`getOrder`) |
| G11 | Customer name and phone for Pharmacist and Pharmacy Manager at their sites, and for Platform Admin everywhere, read on the server | The server adds them for staff on `GET /api/orders` and `GET /api/orders/{id}` (`withCustomerContacts`), for the sites the caller may see. The screen shows neither name nor phone | `apps/sales-service/src/modules/sales-routes.ts` (`GET /orders`, `GET /orders/:id`); `apps/staff-web/src/sections/orders-section.tsx` |
| G12 | Staff see orders at their sites only; store filter limited to them; no site means no orders | The server scopes `/orders` to the caller's sites (`DEFAULT_SITE_SCOPED_PREFIXES`, `siteScopedListPrefixes`): a staff call with no site is refused, and `GET /orders/{id}` answers `404` for another site. The screen has no store filter and no message for an account with no site | `apps/sales-service/src/middleware/trusted-request.ts`; `deploy/aws/lambda/policy.mjs`; `apps/staff-web/src/sections/orders-section.tsx` |
| G13 | Entity-scoped history for everyone who can open the order; actor names | `SalesAuditHistory` calls `/api/audit/logs`, which the edge limits to Platform Admin, so other roles get an error. The actor column shows an id prefix | `apps/staff-web/src/sections/sales/shared.tsx` (`SalesAuditHistory`); `deploy/aws/lambda/policy.mjs` (`platformAdminPaths`) |
| G14 | Open order in the URL as `?order=<id>` | Local state (`openId`), lost on reload | `orders-section.tsx` |
| G15 | One staff and one customer label per status and payment status (Contents table) | Staff `Pending` reads "Chờ xử lý" (the table says "Chờ xác nhận"). Customer `Cancelled` reads "Đã huỷ" (the table says "Đã hủy"). The other status labels match the table | `apps/staff-web/src/i18n/common.ts`; `apps/customer-web/src/storefront/order-status.ts`; `apps/customer-web/src/pages/AccountPage.tsx` |
| G16 | Times in Asia/Ho_Chi_Minh | `formatDateTime` (`staff-api.ts`) uses the browser's zone; staff-web sets no `timeZone` | `apps/staff-web/src/staff-api.ts` (`formatDateTime`) |
| G17 | Export of every matching order | The export writes `filteredRows` (the table's pre-pagination rows), not every matching order | `packages/ui/src/components/data-table.tsx` (`filteredRows`) |
| G18 | Batch rejection releases its reservations and flags the orders (Decision 23) | `reviewBatch` sets the quality status only; no release, no flag | `apps/inventory-service/src/modules/inventory-repository.ts` (`reviewBatch`) |
| G19 | 401 ends the session with the notice and returns after sign-in | The notice shows and the URL is kept (`App.tsx` `endSession`, `staff-api.ts` `send`). The open order is local state (G14), so the drawer does not reopen after sign-in | `apps/staff-web/src/App.tsx`; `apps/staff-web/src/staff-api.ts` (`send`); `apps/staff-web/src/sections/orders-section.tsx` |
