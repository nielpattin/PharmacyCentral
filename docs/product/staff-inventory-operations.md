# Inventory operations (balances, transfers, replenishment, stocktake, adjustments, returns)

- **Status:** Current
- **App and route:** staff-web, `/inventory` (tabs Balances, Batches, Movements, Transfers, Replenishment, Returns, Adjustments, Stocktake), `/transfers`, `/replenishment`, `/stocktake`, `/adjustments`, `/returns`. Each route mounts the inventory workspace (`sections/inventory-section.tsx`) on its own first tab.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code or doc fact checked on 2026-10-26; `[standard]` a decision from industry practice. `Gn` marks a difference between this spec and the code, listed in [Gaps against the code](#gaps-against-the-code-2026-10-26). Business rule ids (`BR-*`) are in [business-rules.md](../business-rules.md), which describes the code as it is; where the target below differs, the gap table says so.

## Purpose

- Stock in a pharmacy is medicine. A wrong count or location can put an expired or unreleased batch on the counter or hide a shortage. `[standard]` Inventory operations let warehouse staff move, count and correct stock only through records with a status. Each record names who made it, and the person who makes a change is never the person who approves it.
- `[observed]` The pages are the warehouse's working surface: see stock per batch, move stock between sites, let a pharmacy counter ask for stock, count shelves, correct balances, and record goods that leave stock.
- `[observed]` Every change to on-hand stock goes through one of the records below, and the stock ledger entry is written in the same transaction (BR-INV-010).

## Users and entry points

- `[observed]` Sign-in is required. Staff only; a customer account gets `employee_required` (BR-AUTH-006).
- `[standard]` Roles on this page. Platform Admin reads every list and record at every site and changes nothing (BR-AUTH-010). Pharmacy Manager reads stock and approves stock changes. Pharmacist sees stock they dispense from and asks for replenishment. Warehouse Staff do the physical work.

| Role | On this page |
| --- | --- |
| Platform Admin | Reads Balances, Batches, Movements, Transfers, Replenishment, Stocktakes, Adjustments, Returns and removals at every site. No action: a batch, transfer, replenishment decision, stocktake, adjustment or return write is refused (BR-AUTH-010). |
| Pharmacy Manager | Reads Balances, Batches and Movements at assigned sites. Approves transfers, adjustments, returns and removals; posts stocktakes; requests replenishment. |
| Pharmacist | Reads Balances and Batches at assigned sites (needed to dispense in FEFO order, BR-INV-007). Requests replenishment for own counter and cancels own requests. |
| Warehouse Staff | Creates, ships and receives transfers; counts stock; proposes adjustments; records returns and removals; approves and fulfils replenishment. |

- `[standard]` Sidebar, target: Warehouse Staff see Transfers, Replenishment, Stocktake, Inventory, Adjustments, Returns and removals. Pharmacy Manager sees Inventory, Transfers, Replenishment, Stocktake, Adjustments and Returns and removals. Pharmacist sees Inventory (read-only tabs) and Replenishment. Platform Admin sees all.
- `[standard]` Every list, count and site selector shows only the sites assigned to the signed-in staff member. Platform Admin sees all sites (BR-AUTH-004).
- `[standard]` A 401 on any request ends the session as the shared rule in [staff-shell-sign-in-and-navigation.md](staff-shell-sign-in-and-navigation.md) describes.

## User stories and acceptance criteria

### US1. As a Pharmacist, Pharmacy Manager or Warehouse Staff member, I see stock on hand, reserved and available per batch at my sites, so that I know what can be moved, counted or dispensed

- Source: `[observed]` BR-INV-006, BR-AUTH-004. `[standard]` Read access for Pharmacist and Pharmacy Manager.
- Accepted when:
  - `/inventory` opens on **Balances** with the columns Product, Batch, Location, On hand, Reserved, Available (on hand minus reserved, BR-INV-006), Quality (`Đã đạt`, `Chờ kiểm tra`, `Từ chối`) and Expiry. Each row matches one `GET /api/inventory/balances` row. (gap G20)
  - An expired batch (expiry before today in Asia/Ho_Chi_Minh) or a batch that is not Released is shown with its state, so the reason it cannot be moved is visible. (gap G20)
  - Searching "Tìm theo số lô" filters by batch number and writes `q` to the URL.
  - **Export CSV** exports every row that matches the filter and site scope, not only the rows loaded on screen, as `inventory-balances.csv`. (gap G20)
  - A Pharmacist sees Balances with no action button, and on Batches only the Release and Reject actions of [staff-quality.md](staff-quality.md).

### US2. As Warehouse Staff, I move stock between two sites, and a Pharmacy Manager approves the move before any stock leaves, so that nobody approves a move they set up

- Source: `[observed]` BR-TRF-001 to BR-TRF-011. `[standard]` Approval by a second person (ISO/IEC 27001 segregation of duties).
- Accepted when:
  - **Tạo điều chuyển** requires a transfer number, a source site and a destination site that differ, and at least one line with product, batch, source location, destination location and quantity above 0. The transfer starts as `Chờ duyệt` (PendingApproval) and on hand does not change. The creator must be assigned to both sites (BR-TRF-011), and the selectors list only sites the creator is assigned to. (gap G5, G8)
  - A line whose batch is not sellable (not Released, or expired) is refused at creation and again at ship. (gap G9)
  - **Duyệt** by a Pharmacy Manager who is not the creator moves `Chờ duyệt` to `Đã duyệt` and records that person as approver.
  - **Xuất** by Warehouse Staff at the source site moves `Đã duyệt` to `Đang vận chuyển` and lowers on hand at the source location by the shipped quantity. A quantity above available (on hand minus reserved) is refused and the transfer stays `Đã duyệt`. (gap G10)
  - **Nhận** by Warehouse Staff at the destination site raises on hand at the destination by the received quantity. A receipt above the shipped quantity is refused. The transfer becomes `Đã nhận` when every shipped quantity is received, or when the receiver closes it with a shortage reason per line; a shortage moves no stock. (gap G10)
  - **Hủy** from `Chờ duyệt` or `Đã duyệt` moves the transfer to `Đã hủy` with no stock effect. Once shipped, a transfer cannot be cancelled.
  - A request to a transfer outside the caller's sites is refused before anything is written.
  - The status filter offers no `Draft`. (gap G11)
  - A Pharmacist calling `POST /api/inventory/transfers` gets 403 (already true).

### US3. As a Pharmacist, I request stock for my counter, and warehouse staff fulfil it from the site's reserve, so that the counter gets stock that is moved, not created

- Source: `[observed]` BR-REP-001 to BR-REP-005. `[standard]` Fulfilment as a move (see Decisions).
- Accepted when:
  - **Yêu cầu bổ sung hàng** by a Pharmacist or Pharmacy Manager saves site, storage location (the counter) and lines (product, batch, requested quantity above 0). The request is `Chờ xử lý` and on hand does not change. Warehouse Staff do not create requests.
  - **Duyệt** or **Từ chối** from `Chờ xử lý` is done by Warehouse Staff, never by the requester.
  - **Thực hiện** on an `Đã duyệt` request names a source storage location at the same site. For each line, on hand drops at the source and rises at the request location by the same requested quantity, both ledger entries in one transaction. The fulfilment is refused if the source has less available stock than requested or the batch is not sellable. (gap G18, G19)
  - **Hủy** from `Chờ xử lý` or `Đã duyệt` is done by the requester or Warehouse Staff, with no stock effect.
  - Bulk **Duyệt** changes only `Chờ xử lý` rows and reports how many were approved.

### US4. As Warehouse Staff, I count a shelf, and a Pharmacy Manager posts the difference, so that the balance changes only after someone other than the counter has checked it

- Source: `[observed]` BR-STK-001 to BR-STK-007. `[standard]` Posting by a second person.
- Accepted when:
  - **Tạo phiên kiểm kê** (site, location, lines for the batches held there) creates a session `Chờ xử lý`. (gap G13)
  - Recording a count of 0 or more sets the line to Counted. The first recorded count moves the session to `Đang kiểm`. A count on a `Hoàn tất` or `Đã hủy` session is refused.
  - **Post** by a Pharmacy Manager who did not count in this session is allowed only when the session is `Đang kiểm` and every line is counted. Each non-zero variance creates one approved adjustment and one ledger entry, on hand moves by the variance, and the session becomes `Hoàn tất`. (gap G12)
  - If the balance of a line changed after that line was counted, the line goes back to uncounted, the post is refused and the message names the batch. Nothing is written. (gap G13)
  - An open session (`Chờ xử lý` or `Đang kiểm`) can be cancelled by Warehouse Staff or a Pharmacy Manager with no stock effect. (gap G14)

### US5. As Warehouse Staff, I propose a stock correction, and a Pharmacy Manager approves or rejects it, so that a balance changes only after review

- Source: `[observed]` BR-ADJ-001 to BR-ADJ-008. `[standard]` Approval roles.
- Accepted when:
  - **Gửi điều chỉnh tồn kho** requires type Positive (`Tăng`) or Negative (`Giảm`), quantity above 0, and a reason of 1 to 500 characters. The row is `Chờ xử lý` and on hand does not change.
  - **Duyệt** by a Pharmacy Manager who is not the proposer changes on hand by plus or minus the quantity and writes a ledger entry. A result below zero or below reserved is refused with "Adjustment would make available stock negative" and the row stays `Chờ xử lý`. A Positive adjustment is refused unless the batch is sellable. (gap G19)
  - **Từ chối** by the same roles, not the proposer, requires a note of 1 to 500 characters; on hand is unchanged. **Duyệt** takes an optional note. (gap G17)
  - Bulk approve and reject act only on `Chờ xử lý` rows and apply the same checks to each row.

### US6. As Warehouse Staff, I record goods returned to a supplier or removed from stock, and a Pharmacy Manager approves the removal, so that stock leaves the shelf only after a second check

- Source: `[observed]` BR-RET-001 to BR-RET-005. `[standard]` Approval roles.
- Accepted when:
  - **Ghi nhận trả hàng hoặc loại hàng khỏi kho** requires a site in scope, a reason chosen from `Trả nhà cung cấp`, `Hàng hư hỏng`, `Hàng hết hạn` or `Loại khỏi tồn`, and per line a batch, a storage location, a quantity above 0 and no more than the available quantity. Destination and occurred-at are optional. The record is `Chờ xử lý` and on hand does not change. (gap G15, G16)
  - **Duyệt** by a Pharmacy Manager who did not record the return moves on hand down by each line (InventoryReturn), re-checks available stock, and sets `Đã duyệt`. **Từ chối** sets `Từ chối` with no stock change. (gap G16)
  - A removal is never refused because a batch is expired or Rejected. Those are the batches that must leave.
  - A Pharmacist calling `POST /api/inventory/returns` gets 403 (already true).

### US7. As a user who can open a record, I read its history, so that I can see who did what and when

- Source: `[standard]` Entity history. `[observed]` Inventory writes are already audited (`apps/inventory-service/src/modules/audit/audit-rules.ts`).
- Accepted when:
  - Transfer, replenishment, stocktake, adjustment and return detail each have a **Lịch sử** tab listing that record's events: action, actor, time. (gap G21)
  - The tab reads only that record's history, so anyone who can open the record sees it and nobody else does. The full Audit page stays Platform Admin only (BR-AUDIT-004).

### US8. As Warehouse Staff, I see which stock another site is short of and where the chain holds a surplus, so that I move stock that already exists instead of ordering more

- Source: `[standard]` Rebalancing stock across a chain. `[observed]` BR-TRF-001 to BR-TRF-012, BR-INV-007.
- Accepted when:
  - The Transfers page opens with a **Điều chuyển gợi ý** section above the transfer list: product, source site, destination site, the cover of each side, the suggested quantity and a **Tạo điều chuyển** action. It reads `GET /api/inventory/transfer-suggestions` and writes nothing.
  - Only sellable stock counts: released, unexpired batches, with reserved stock subtracted. A source keeps 45 days of its own cover; a site under 14 days of cover receives stock up to 30 days. Stock that the destination cannot sell before it expires is never suggested, and stock expiring today is not moved.
  - A row appears only when both sites are in the caller's scope. Platform Admin and Pharmacy Manager read the list; only Warehouse Staff get the row action, and the action column is absent when they may not create.
  - **Tạo điều chuyển** opens the existing create form filled with the product, both sites and the suggested quantity. The batch and the two storage locations stay a choice, and the transfer is still `Chờ duyệt` until a Pharmacy Manager approves it (US2).
  - With nothing to move, the table says so in its empty state; a failed read shows the error, never an empty list.
  - The section states the rule it applied (45 days kept, 14 days trigger, 30 days target, expiry cap), so a reader can explain a missing row.

## Contents and behavior

`[observed]` for the current layout. The target differences are in the gap table.

| Area | List and filters | Create | Status flow | Stock effect |
| --- | --- | --- | --- | --- |
| Balances (`/inventory`) | Search by batch number; CSV export | None | None | Read only |
| Batches (`/inventory`) | Batch list; quality verdicts belong to [staff-quality.md](staff-quality.md) | **Tạo lô** (Warehouse Staff) | Quality only | None here |
| Movements (`/inventory`) | Ledger, read only | None in the target (G19) | None | None |
| Transfers (`/transfers`) | Suggested transfers above the list; transfer number; status filter (PendingApproval, Approved, InTransit, Received, Cancelled) | **Tạo điều chuyển** (also from a suggestion, prefilled) | Chờ duyệt → Đã duyệt → Đang vận chuyển → Đã nhận; Hủy before ship | Ship: down at source. Receive: up at destination |
| Replenishment (`/replenishment`) | Notes or batch number; status filter (Pending, Approved, Fulfilled, Rejected, Cancelled) | **Yêu cầu bổ sung hàng** | Chờ xử lý → Đã duyệt → Đã thực hiện; Từ chối; Hủy | Fulfil: move from reserve location to request location |
| Stocktake (`/stocktake`) | Notes or batch number; status filter (Pending, InProgress, Completed, Cancelled) | **Tạo phiên kiểm kê**; **Ghi nhận số đếm kiểm kê** | Chờ xử lý → Đang kiểm → Hoàn tất; Hủy khi còn mở | Post: up or down by each variance |
| Adjustments (`/adjustments`) | Reason, notes or batch number; status filter (Pending, Approved, Rejected) | **Gửi điều chỉnh tồn kho** | Chờ xử lý → Đã duyệt or Từ chối | Approve: ± quantity |
| Returns and removals (`/returns`) | Site filter; status filter (Pending, Approved, Rejected) | **Ghi nhận trả hàng hoặc loại hàng khỏi kho** | Chờ xử lý → Đã duyệt or Từ chối | Approve: down by each line quantity |

**Status labels** (staff only; these records have no customer view, so there is no customer label):

| Record | Status | Staff label |
| --- | --- | --- |
| Transfer | PendingApproval / Approved / InTransit / Received / Cancelled | `Chờ duyệt` / `Đã duyệt` / `Đang vận chuyển` / `Đã nhận` / `Đã hủy` |
| Replenishment | Pending / Approved / Fulfilled / Rejected / Cancelled | `Chờ xử lý` / `Đã duyệt` / `Đã thực hiện` / `Từ chối` / `Đã hủy` |
| Stocktake | Pending / InProgress / Completed / Cancelled | `Chờ xử lý` / `Đang kiểm` / `Hoàn tất` / `Đã hủy` |
| Adjustment, return | Pending / Approved / Rejected | `Chờ xử lý` / `Đã duyệt` / `Từ chối` |
| Batch quality | Released / PendingQc / Rejected | `Đã đạt` / `Chờ kiểm tra` / `Từ chối` |

**Who may act (target).** `[standard]` The server enforces this matrix; the UI only hides what the server would refuse. "Not the creator" means the approver is a different person from the one who created or counted the record.

| Action | Who may do it | Today (gap) |
| --- | --- | --- |
| View Balances | Platform Admin everywhere; Pharmacy Manager, Pharmacist and Warehouse Staff at assigned sites | Matches the target. |
| View Batches and Movements | Platform Admin everywhere; Pharmacy Manager (both), Pharmacist (Batches only) and Warehouse Staff at assigned sites | Matches the target. |
| Create, ship, receive transfer | Warehouse Staff (create needs both sites; ship at source; receive at destination) | Warehouse Staff; create needs both sites. Ship and receive check neither sellable batches nor quantities (G9, G10). |
| Approve transfer | Pharmacy Manager; not the creator | Matches the target. |
| Cancel transfer | Warehouse Staff at source site, Pharmacy Manager | Warehouse Staff or Pharmacy Manager at the source site. |
| Request replenishment | Pharmacist, Pharmacy Manager at the site | Matches the target. |
| Approve, reject, fulfil replenishment | Warehouse Staff; not the requester | Warehouse Staff; requester refused. Fulfil adds stock with no source (G18). |
| Cancel replenishment | Requester, Warehouse Staff | Requester or Warehouse Staff. |
| Create stocktake; record count | Warehouse Staff | Warehouse Staff |
| Post stocktake | Pharmacy Manager; not a counter in the session | Pharmacy Manager; a counter is refused. Post is still offered on `Chờ xử lý` (G12). |
| Cancel stocktake | Warehouse Staff, Pharmacy Manager | Not possible (G14) |
| Propose adjustment | Warehouse Staff | Warehouse Staff |
| Approve or reject adjustment | Pharmacy Manager; not the proposer | Roles and the proposer check match the target. A reject without a note is accepted (G17). |
| Record return or removal | Warehouse Staff | Warehouse Staff; final at once (G16) |
| Approve return or removal | Pharmacy Manager; not the recorder | Not possible (G16) |

**Other behavior.** `[observed]` Every write that changes stock or an approval asks for confirmation that names the effect, for example "Duyệt điều chuyển này?" and "Đăng điều chỉnh kiểm kê?", whose body says the change "cannot be undone from this screen". `[observed]` Pressing **N** opens the create drawer where one exists. `[standard]` Drawers and confirmations are operable by keyboard, focus returns to the control that opened them, and status is shown as text, not colour alone (WCAG 2.2 AA). `[standard]` Documents are never edited after creation: a mistake is cancelled and recorded again. Nothing is hard-deleted.

## States

- `[observed]` Loading: each table shows its loading state; a detail drawer shows a skeleton until its record loads.
- `[standard]` Error: the list shows the error message and no rows. An error is never shown as zero, empty or "not found".
- `[observed]` Empty: table empty state; transfer and stocktake lines show "Chưa có dòng".
- `[observed]` Refused action: an error toast with the server message; the row does not change. The message must be Vietnamese. Refusals without a Vietnamese text are gap G22.
- `[standard]` Signed out or session ended: the user sees a Vietnamese notice, lands on sign-in and returns to the page after sign-in.
- `[observed]` Role without access: the sidebar item is absent, and a direct URL falls back to the first tab the role may use.

## Out of scope

- Batch creation, release and rejection, and what a rejected batch does to its reservations: [staff-quality.md](staff-quality.md).
- Goods receipts and purchase orders: [staff-procurement-and-receiving.md](staff-procurement-and-receiving.md).
- Reservation of stock for orders and prescriptions (BR-INV-009, BR-RX-005 to BR-RX-007). Reserved is shown here and changed only by sales.
- Editing a document after creation; stock accounting value (finance); bulk actions on transfers, stocktakes and returns.

## Rules and designs

- Business rules: [BR-AUTH-002, 004, 005, 006](../business-rules.md), [BR-INV-003, 004, 006, 007, 009, 010](../business-rules.md), [BR-TRF-001 to 012](../business-rules.md), [BR-REP-001 to 006](../business-rules.md), [BR-STK-001 to 007](../business-rules.md), [BR-ADJ-001 to 008](../business-rules.md), [BR-RET-001 to 005](../business-rules.md), [BR-QUALITY-003, 004](../business-rules.md), [BR-AUDIT-001 to 004](../business-rules.md), and the known gaps [BR-GAP-002, 003, 004, 005](../business-rules.md).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): stock is the server's; the screens only preview.
- [User guide, Inventory operations](../user-guide.md#inventory-operations) and [Roles and workspaces](../user-guide.md#roles-and-workspaces) describe the screens and must match the target once the gaps close. The [API guide](../api-guide.md) lists the inventory endpoints and the dashboard counts that filter on transfer status.
- Standards: ISO/IEC 27001 (segregation of duties), WCAG 2.2 AA. FEFO is common practice for picking.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Who may approve replenishment? BR-REP-006 says Warehouse Staff. | Warehouse Staff approve, reject and fulfil. Pharmacist and Pharmacy Manager request. Platform Admin reads and decides nothing (BR-AUTH-010). A requester never approves their own request. `[standard]` | Stores request and the warehouse fills, as BR-REP-006 and the user guide say. The person asking for stock should not also release it. Owner may change. |
| 2 | Why is Pharmacist open to replenishment when the other tabs are warehouse-only? | A Pharmacist requests for their own counter and cancels their own requests. They do not approve, fulfil or move stock. `[standard]` | They see the shortage first. The check that moves stock belongs to the warehouse (segregation of duties). Owner may change. |
| 3 | Which reasons apply to a return: free text or fixed reasons? | A required choice: `Trả nhà cung cấp`, `Hàng hư hỏng`, `Hàng hết hạn`, `Loại khỏi tồn`. Free text only as optional notes (up to 1000 characters). `[standard]` | Losses are reported by category. The i18n keys and the user guide already name these four. |
| 4 | Approval notes on adjustments. | Approve: optional note. Reject: note required, 1 to 500 characters. `[standard]` | A rejected proposer needs to know why. The server already accepts `approvalNotes`. |
| 5 | Should transfers have `Draft`? | No. A new transfer is `Chờ duyệt` (BR-TRF-004). `Draft` is removed from the filter and from the dashboard count. `[standard]` | No code path writes `Draft`. An unused state inflates the pending-transfer count. |
| 6 | Separation of duties. | Enforced on the server: nobody approves, decides or posts a record they created or counted. Platform Admin takes none of these actions at all (BR-AUTH-010). The UI check alone is not a control. `[standard]` | ISO/IEC 27001 segregation of duties. |
| 7 | Same-site transfer. | Refused. Source and destination sites must differ. A move inside one site is a fulfilment from reserve (row 14). `[standard]` | A transfer changes the site that holds the stock. A move inside a site does not, so it belongs to replenishment. |
| 8 | Stocktake `InProgress`. Does any path set it? | The first recorded count sets `Đang kiểm`. Post is allowed only from `Đang kiểm` with every line counted. A `Chờ xử lý` session cannot be posted. `[standard]` | The status must mean something. The drawer and the row already offer Post for these states. |
| 9 | Should non-warehouse staff read Balances? | Pharmacist and Pharmacy Manager read Balances and Batches at assigned sites, read-only. `[standard]` | A Pharmacist must see batches to dispense in FEFO order. A Pharmacy Manager reviews transfers and adjustments. Owner may change. |
| 10 | Should site selectors list every site? | Every list and selector shows assigned sites only. Platform Admin sees all. `[standard]` | BR-AUTH-004; least privilege. |
| 11 | Why do returns and removals have no approval step? | Removals are approved like adjustments: recorded `Chờ xử lý`, stock moves when a Pharmacy Manager approves, and the recorder cannot approve. `[standard]` | Removing stock carries the same risk as correcting it. Goods must not leave on one person's record. Owner may change (who approves). |
| 12 | Which batches may a transfer carry? | Only sellable batches (Released and unexpired), checked at creation and at ship. `[standard]` | BR-QUALITY-003 and BR-QUALITY-004; a transfer carries stock to another site's shelves. |
| 13 | How are ship and receive quantities bounded? | Ship no more than approved; receive no more than shipped. The receiver closes a shortfall with a reason per line; no stock changes, because the source already dropped at ship. `[standard]` | Partial deliveries happen. The record needs a closing state without inventing stock. |
| 14 | How does a counter get stock? | Fulfilment moves stock from a same-site reserve location to the request location. Site total is unchanged. `[standard]` | Adding stock with no source creates stock that no receipt or count supports (BR-REP-004 today). |
| 15 | A count taken before a movement. | The variance is measured against the on-hand quantity captured when the line was counted. If the balance changed since, the line goes back to uncounted. `[standard]` | Otherwise a post overwrites a sale or transfer that happened after the count. |
| 16 | Can a stocktake be cancelled? | An open session can be cancelled with no stock effect. `[standard]` | `Đã hủy` is already in the filter. An abandoned count must be able to close. |
| 17 | Can stock be added to a batch that cannot be sold? | Adds (Positive adjustment, fulfilment) only into sellable batches. Removals are allowed from any batch. `[standard]` | Rejected and expired stock must still be removable. New stock must not reach a shelf that sells it. |
| 18 | What do exports and balances show? | Export covers every filtered row. Balances show Available and Quality. `[standard]` | Staff need the full set and the reason a batch cannot move. |
| 19 | Where is a record's history? | A **Lịch sử** tab on each record, reading that record's events only, visible to anyone who can open the record. `[standard]` | Entity history gives the answer without the admin-only Audit page (BR-AUDIT-004). |
| 20 | May a staff member create a transfer if assigned to one site only? | No. The creator must be assigned to both sites. `[standard]` | BR-TRF-011. |
| 21 | Does a suggestion create a transfer? | No. The list is read-only and only opens the create form prefilled with the product, sites and quantity; batch and locations stay a choice, and approval is unchanged. `[standard]` | A draft nobody asked for clutters the approval queue, and the batch and locations are a warehouse decision. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G3 | A Pharmacy Manager approves transfers, decides adjustments, posts stocktakes and approves returns; Platform Admin does none of them. | Transfer approval, adjustment decisions and stocktake posts are Pharmacy Manager only, with the approver checked; Platform Admin is refused. Returns still have no approval route (G16). Code is incomplete. | `apps/staff-web/src/permissions/staff-permissions.ts`; `apps/inventory-service/src/modules/inventory-routes.ts`. |
| G5 | Selectors show only the caller's assigned sites. | Every site selector lists all sites. | `apps/staff-web/src/sections/inventory/labels.ts` (`siteOptions`), used by `create-transfer.tsx`, `adjustments.tsx`, `movements.tsx`, `returns.tsx`, `replenishment.tsx`, `stocktake.tsx`. |
| G8 | Source and destination must differ. | No check in the schema or repository. BR-GAP-003 records it. | `apps/inventory-service/src/modules/inventory-routes.ts` (`transferSchema`); `inventory-repository.ts` (`createTransfer`); BR-TRF-001, BR-GAP-003. |
| G9 | Ship, receive and create refuse batches that are not sellable. | Only available quantity is checked. BR-TRF-007 says BR-QUALITY-003 applies to transfers, which the code does not do. | `inventory-repository.ts` (`transitionTransfer`, `createTransfer`). Correct BR-TRF-007 when fixed. |
| G10 | Ship no more than approved; receive no more than shipped; shortfall closed with a reason; `Đang vận chuyển` until closed or fully received. | `lineCommands` quantities are not compared with the approved or shipped quantity (BR-GAP-003). A partial ship leaves the rest unrecorded. No shortage close. Status stays `Đang vận chuyển` until every line is received in full. | `inventory-repository.ts` (`transitionTransfer`); `inventory-routes.ts` (transfer actions). BR-TRF-010, BR-GAP-003. |
| G11 | No `Draft` status. | The transfer filter lists `Draft`. No code writes it. The API guide's dashboard example and BR-REPORT-005 include it. | `apps/staff-web/src/sections/inventory/status.ts` (`TRANSFER_STATUSES`); [api-guide.md](../api-guide.md) (dashboard `pendingTransferCount`); [business-rules.md](../business-rules.md) BR-REPORT-005. Align docs. |
| G12 | First count sets `Đang kiểm`; post only from `Đang kiểm` with every line counted; counts refused on `Hoàn tất` or `Đã hủy`. | The server does all three (`countStocktakeLine`, `postStocktake`). The row still offers Post for `Chờ xử lý` (`canPost`), which the server refuses. Code is incomplete. | `apps/staff-web/src/sections/inventory/stocktake.tsx` (`canPost`, row action). |
| G13 | On-hand is captured at count; post refuses a line whose balance changed since the count. | `createStocktake` captures `systemQuantity` at creation. `postStocktake` computes the variance from it and adds it to the current on-hand. | `inventory-repository.ts` (`createStocktake`, `postStocktake`). |
| G14 | An open session can be cancelled with no stock effect. | No cancel transition or route. `Cancelled` appears in the filter. | `apps/staff-web/src/sections/inventory/status.ts`; `inventory-routes.ts`. |
| G15 | Return reason is one of four fixed values; notes are free text. | `returnSchema.reason` is free text (1 to 500). The form has a free-text "Reason". The `returns.reason.*` keys have no consumer. | `inventory-routes.ts` (`returnSchema`); `apps/staff-web/src/sections/inventory/returns.tsx`; `apps/staff-web/src/i18n.ts`. The user guide already lists the four reasons; code is wrong. |
| G16 | Returns and removals are `Chờ xử lý` until approved; stock moves on approval; rejection changes nothing. | `createReturn` writes the request as `Completed` and moves stock at once. No approval route. | `inventory-repository.ts` (`createReturn`); `inventory-routes.ts`. Align [user-guide Inventory operations](../user-guide.md#inventory-operations) and BR-RET-001 to 005. |
| G17 | Reject requires a note; approve takes an optional note. | The server accepts optional `approvalNotes`. The UI sends none and requires none. The `adjustments.approvalNotes` key has no consumer. The user guide says "optional approval notes" for both. | `inventory-routes.ts` (adjustment action); `adjustments.tsx`; `i18n.ts`. Align the user guide Adjustments workflow. |
| G18 | Fulfilment moves stock from a same-site reserve location to the request location. | `transitionReplenishment` (fulfill) adds `requestedQuantity` at the request location with no source. BR-REP-004 describes the same. | `inventory-repository.ts` (`transitionReplenishment`); BR-REP-004 changes with the code. |
| G19 | Stock may be added only to sellable batches; the raw **Record stock movement** form is not a target workflow. | Fulfilment and Positive adjustment do not check Released or expiry. `POST /inventory/movements` accepts any batch (BR-GAP-002), and the UI offers it. | `inventory-repository.ts` (`transitionReplenishment`, `transitionAdjustment`); `inventory-routes.ts` (`POST /inventory/movements`); `apps/staff-web/src/sections/inventory/movements.tsx`. |
| G20 | Balances show Available and Quality; Export CSV exports all filtered rows. | Columns are Product, Batch, Location, On hand, Reserved, Expiry. Export writes the loaded, filtered rows. | `apps/staff-web/src/sections/inventory/balances-batches.tsx`; `packages/ui/src/components/data-table.tsx` (`filteredRows`). |
| G21 | Each record has a **Lịch sử** tab reading its events. | No history tab on transfers, replenishment, stocktake, adjustments or returns. Events exist (`audit-rules.ts`) and appear only on the Audit page. | `apps/staff-web/src/sections/inventory/`; `apps/inventory-service/src/modules/audit/audit-rules.ts`. |
| G22 | Every refusal message shown to the user is Vietnamese. | Refusals such as "Adjustment would make available stock negative", "Insufficient stock for transfer product" and "Stocktake is already Completed" have no entry in `staff-web/src/i18n/inventory.ts`. | `apps/staff-web/src/i18n/inventory.ts`; server messages in `inventory-repository.ts`. |
