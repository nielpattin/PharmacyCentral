# Staff dashboard and counter overview

- **Status:** Current
- **App and route:** staff-web, `/` (Dashboard), `/pharmacist-overview` (Counter overview, "Tổng quan quầy")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-11-07

Tags: `[observed]` read from the code on 2026-10-26; `[owner]` a recorded owner decision (none on this page yet); `[standard]` a decision from industry practice. Gaps against the code are in the table at the end. See [README](README.md).

## Purpose

- `[observed]` Two screens over the sites the signed-in employee is assigned to. **Dashboard** (`/`) shows stock and approvals that need action, catalog and stock totals, and recent activity; it is read only. **Counter overview** (`/pharmacist-overview`, "Tổng quan quầy") is the Pharmacist's counter screen: what needs attention before a sale, then the counter payments the Pharmacist acts on.
- `[standard]` Each screen answers one daily question: what needs action (managers, warehouse) and what must be known before a sale (pharmacist). Changes happen on the page that owns the record, so the person who reviews a figure is not the one who changes it (least privilege, segregation of duties). A figure is useful only when it is real and a failure is visible; a missing figure reads as "—", never as zero.

## Users and entry points

Signed-in staff only. Sign-in and the sidebar are in the [shell spec](staff-shell-sign-in-and-navigation.md).

| Section | Route | Who may open it (target) | Code today |
| --- | --- | --- | --- |
| Dashboard | `/` | Platform Admin, Pharmacy Manager, Warehouse Staff | Same in `sectionRoles` (`permissions/section-access.ts`); the API admits the same roles. |
| Counter overview | `/pharmacist-overview` | Pharmacist acts; Pharmacy Manager reads only; no entry for the other roles | Pharmacist only (`sectionRoles`); Pharmacy Manager has no entry (G25). Platform Admin has no entry either, as BR-AUTH-010 requires. The attention block is not rendered (G14). |

- `[observed]` A Pharmacist has no Dashboard entry. A direct URL to a section the role may not open falls back to the first visible section (`activeSection`, `App.tsx`). A Pharmacist lands on Counter overview after sign-in; managers and Warehouse Staff land on Dashboard. The sidebar label is "Pharmacist overview" (`App.tsx`), shown in Vietnamese as "Tổng quan quầy" (`i18n/shell.ts`).

## User stories and acceptance criteria

### US1. As a Pharmacy Manager or Warehouse Staff member, I see the stock and approvals that need action first

- Source: `[observed]` the six tiles; `[standard]` the definitions (decisions 12, 13, 16).
- Accepted when:
  - `/` shows the group "Cần xử lý" with six tiles: "Lô tồn thấp", "Lô sắp hết hạn", "Điều chuyển chờ xử lý", "Đơn thuốc đang mở" (not for Warehouse Staff, G9), "Kiểm kê đang mở" and "Điều chỉnh đang chờ". Each tile links to its worklist, keeping the selected site (G8).
  - "Lô tồn thấp" counts batch balances with 0 < available ≤ 10, where available is on hand minus reserved. A balance with nothing available is not counted (G2). Threshold per [BR-REPORT-002](../business-rules.md).
  - "Lô sắp hết hạn" counts batches that hold on-hand stock and expire on or before today + 30 days, including stock already expired (G3). Window per [BR-REPORT-003](../business-rules.md).
  - Test: seed one balance with available 10 and one batch with stock expiring in 30 days; both tiles show `1`. Seed one balance with nothing on hand; "Lô tồn thấp" does not count it (G2).
  - A tile carries the warning tone only when its count is above 0.

### US2. As a staff member, I see the size of the catalog and stock

- Source: `[observed]`.
- Accepted when:
  - Group "Danh mục và tồn kho" shows "Cơ sở đang hoạt động" and "Vị trí lưu trữ" as `active / total`, "Sản phẩm", "Nhà cung cấp", "Đang có" (on hand) and "Đã giữ" (reserved), all from one response.
  - "Sản phẩm" equals `GET /api/products/count` with no filter, which counts active products only. A site-scoped employee sees site and location totals for their own sites only.
- Rules: [BR-REPORT-001](../business-rules.md), BR-AUTH-004.

### US3. As a manager with several sites, I choose one site, so that the figures match the pharmacy I am at

- Source: `[standard]` (site scope); `[observed]` the API already accepts a site for employees.
- Accepted when:
  - A "Cơ sở" selector on the dashboard lists the employee's assigned sites, default "Tất cả cơ sở được gán". Platform Admin sees every site (G7).
  - Choosing a site sends `siteId`; every figure and row narrows to it, and the choice stays in the URL. A site outside the employee's assignment is refused with 403 `site_access_denied` (`trusted-request.ts`).

### US4. As a staff member, I see the latest activity for my sites

- Source: `[observed]`; the role split is `[standard]`.
- Accepted when:
  - "Hoạt động gần đây" lists at most 30 audit rows, newest first, each with its action, entity, actor and time (`operations-repository.ts`, `DASHBOARD_ACTIVITY_LIMIT`). The page folds runs of the same action and shows the latest few.
  - A site-scoped employee sees only rows whose audit entry names one of their sites; rows with no site are left out (`operations-repository.test.ts`).
  - The server filters by role (`dashboardActionFamilies` in `operations-access.ts`): Warehouse Staff get only actions that start with `inventory.` or `procurement.`; Platform Admin and Pharmacy Manager get every action; a person with several roles gets the widest set; a role with no dashboard access gets none (`operations-access.test.ts`, `operations-repository.test.ts`).
  - The card shows "Dữ liệu tới HH:mm" from the projection lag (G11). With no rows it shows "Chưa có hoạt động gần đây".
- Rules: BR-AUDIT-001, BR-AUDIT-002, BR-AUTH-004.

### US5. As a Pharmacist, I see what needs attention before I serve the counter at my sites

- Source: `[standard]` (read-only stock at the site, first-expiry-first-out, no sale of expired stock). The copy `pharmacistOverview.*` in `i18n.ts` describes this block, but nothing renders it.
- Accepted when:
  - Above the counter tabs, the block "Cần xử lý trước khi bán tại quầy" shows three counts, each linking to its list: balances with 0 < available ≤ 10; batches with stock expiring within 30 days; replenishment requests for the pharmacist's sites not yet fulfilled (G14).
  - It reads `GET /api/inventory/balances` (each row carries its batch and expiry) and `GET /api/inventory/replenishment`, limited to the employee's sites.
  - It has no approve, fulfil or cancel control. A Pharmacist raises requests on Replenishment. A Pharmacy Manager sees the same block, read only.
- Rules: [BR-RX-000](../business-rules.md), BR-AUTH-004.

### US6. As a Pharmacist, I confirm cash and refund counter payments; a Pharmacy Manager reads the list only

- Source: `[observed]` the tab and its filters; `[standard]` the action split.
- Accepted when:
  - `/pharmacist-overview` opens the tab "Giao dịch tại quầy" by default; the tab and the search are in the URL.
  - The list shows counter invoices only; online-order invoices are left out on every page. The search "Tìm theo số hóa đơn" filters by invoice number.
  - "Confirm cash" and "Refund" appear only for a Pharmacist and only in states that allow them (`canConfirmCash`, `canRefund`).
  - A Pharmacy Manager sees "Chỉ xem: xuất thuốc, thanh toán và trả lời tư vấn cần vai trò Dược sĩ." above the tabs, on every tab (gap G25). Platform Admin does not open this page (BR-AUTH-010).
- Rules: [BR-RX-000](../business-rules.md), BR-AUTH-004.

### US7. As any user of these screens, I never read a failed or unanswered figure as zero

- Source: `[standard]` (real data, visible failure, data time shown).
- Accepted when:
  - When `GET /api/dashboard/summary` fails, the red alert shows the Vietnamese message and every tile shows "—", not 0 (G5).
  - A figure the server did not answer shows "—". The network-wide dashboard does not show a projection value as current when a live figure is 0 or unreachable (G6).
  - The dashboard refreshes every 60 seconds while visible; "Làm mới" refreshes now, beside "Cập nhật lúc HH:mm" (G12).
  - A 401 on these screens ends the session with a Vietnamese notice and returns the user to sign-in, as the shell spec requires.
  - No figure is random, mocked or zero-filled: `grep -rn "Math.random\|mockData\|MOCK_"` over `apps/staff-web/src/sections/dashboard-section.tsx` and `apps/staff-web/src/sections/finance` finds nothing (met today).
- Rules: [BR-REPORT-001](../business-rules.md), BR-FIN-002, BR-FIN-003 (no guessed values).

## Contents and behavior

`[observed]` for the layout. The reason for each block is `[standard]`.

- **Dashboard (`/`).** The site selector (US3); the group "Cần xử lý" (US1); "Danh mục và tồn kho" (US2); the card "Hoạt động gần đây" (US4). Each figure is a count or total from one request. No charts.
- **Counter overview (`/pharmacist-overview`).** The attention block (US5), then the tabs "Giao dịch tại quầy" (default), "Đơn thuốc" and "Tư vấn". The prescription and consultation tabs are covered by the [prescriptions spec](staff-prescriptions-and-counter.md).

| Screen | Request | Answered by today | Target |
| --- | --- | --- | --- |
| Dashboard | `GET /api/dashboard/summary` | operations-query-service `:3007`: projections plus HTTP reads (G24) | Projections only, with `projectionLag` shown (decision 7) |
| Counter overview, attention | `GET /api/inventory/balances`, `GET /api/inventory/replenishment` | inventory-service, site-scoped by the service | Unchanged |
| Counter transactions | `GET /api/payments/invoices` | payment-service | Unchanged |

## States

- **Dashboard loading:** skeleton tiles in both groups and one skeleton block under "Hoạt động gần đây" (observed).
- **Dashboard error:** the red alert with the message, and every tile "—" (target; today the tiles show "0", G5).
- **Dashboard empty:** a true zero shows "0"; the activity card shows "Chưa có hoạt động gần đây".
- **Counter overview loading or error:** the table's loading state; the red alert with the message. Empty: "Chưa có thanh toán tại quầy." When a page held only online-order invoices and more pages exist, the page-level message with "Tải thêm".
- **Attention block:** when all three counts are 0, "Không có mục cần xử lý"; a failed read shows the alert, never an empty block.

## Out of scope

- `[standard]` Charts and trend lines; the history they need is not kept on these screens.
- `[standard]` Writes from any figure. Approvals and changes happen on the pages that own the records.
- `[observed]` Paid, refunded and net totals: see [Finance](staff-finance.md) (BR-FIN-001). Stock valuation: see Analytics, Inventory tab.
- `[standard]` Patient or customer names on either screen. Mock or sample figures.

## Rules and designs

- Business rules: [BR-REPORT-001 to 007](../business-rules.md); [BR-FIN-001 to 003](../business-rules.md); [BR-AUDIT-001 to 004](../business-rules.md); [BR-AUTH-001 and 004](../business-rules.md) (roles, site scope; menus are display only, the backend is the control); [BR-RX-000](../business-rules.md) (Pharmacist counter workspace).
- [ADR 0003](../adr/0003-transactional-outbox-and-integration-events.md) (Accepted) and [design 0001](../design/0001-operations-query-reads-only-events.md) (Draft, not implemented): operations-query reads only through events. [Architecture](../architecture.md) lists the HTTP reads as a known deviation.
- [API guide, query projections](../api-guide.md#query-projections): response shape of `GET /api/dashboard/summary`.
- [User guide, Dashboard](../user-guide.md#dashboard).
- Tests: `operations-repository.test.ts` (dashboard site scope), `operations-repository-counts.test.ts` (open-state filters, counts beyond one page), `operations-pages.test.ts` (audit paging). No automated test covers `dashboard-section.tsx` or the counter overview.

## Decisions

Rows 1 to 11 answer the questions of the earlier draft. Rows 12 to 21 settle behavior this spec now requires. Rows 8, 9, 17 and 21 belonged to the Reporting screen and were removed with it; the numbers stay so that other pages' citations still resolve. "Owner may change" marks only genuine policy choices.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Why do the two screens exist? | `[standard]` Dashboard: what needs action. Counter overview: what the pharmacist needs before and at a sale. Neither of them changes a record outside its own tab. | Each role needs a view scoped to its work (least privilege). |
| 2 | Why is the Counter overview a payment list? | `[standard]` Keep "Giao dịch tại quầy" as the default tab, below the attention block. | A payment waiting for cash confirmation stops a sale, so it comes right after the stock warnings. |
| 3 | Site filter: selector or assigned-site scope only? | `[standard]` A selector (US3). Default is every assigned site; one site narrows every figure and row. | Multi-site managers need one pharmacy's figures. The API already accepts `siteId` for employees (`listSiteIds`). |
| 4 | Error state shows zeros: dash or nothing? | `[standard]` On error every tile shows "—" beside the alert. Never 0. | An error is not an empty result. A zero beside an error reads as real stock (fail visibly). |
| 5 | Is a pharmacist-facing summary intended? Should the default tab change? | `[standard]` Yes: the attention block (US5). The default tab stays "Giao dịch tại quầy". | A Pharmacist sells first-expiry-first-out and must not sell expired stock. The block is read only, so it adds no write path. |
| 6 | Is the open-prescription count meant for Warehouse Staff? | `[standard]` No. The tile is for Platform Admin and Pharmacy Manager. | Prescriptions are clinical work, and Warehouse Staff have no clinical duty (least privilege). |
| 7 | Projection or HTTP count: which is the contract? | `[standard]` ADR 0003 and design 0001: figures come from operations-query's own projections, with `projectionLag` shown. The HTTP reads are a known deviation until design 0001 lands. | ADR 0003 is Accepted and comes before the code. Until then an unanswered figure is "—" (decision 4), never a stale value shown as current. |
| 10 | Are the unused `dashboard.*` i18n keys a leftover? | `[standard]` Yes. Delete the `dashboard.*` copy the dashboard does not use, in both languages. Keep `pharmacistOverview.*` for decision 5. | Dead copy misleads the next editor, and the two languages drift apart. |
| 11 | Should the data-integrity rule be in business-rules.md? | `[standard]` Yes. Add it to section 17 with an id to be assigned: admin screens show real data, and a failed or unanswered figure is shown as failed. | A rule kept in team notes cannot be cited or tested. |
| 12 | (new) Low-stock definition | `[standard]` A batch balance with 0 < available ≤ 10. Nothing available is out of stock, not low stock. Owner may change: the threshold 10 is stock policy. | Balances stay at zero after every dispense and would inflate the tile. Out of stock shows as "Hết hàng" on the storefront. |
| 13 | (new) Expiring-batch definition | `[standard]` Batches holding on-hand stock that expire on or before today + 30 days, including stock already expired. Owner may change: the 30-day window is stock policy. | Expired stock is not sellable (inventory `site-availability.ts`) and needs action, so it is counted. |
| 14 | (new) Recent activity by role; data time | `[standard]` Warehouse Staff see inventory and procurement actions. Platform Admin sees every action at every site; a Pharmacy Manager sees all actions at their sites. The card shows "Dữ liệu tới HH:mm". | Least privilege. A lag value shows whether the activity is current, not only a status word. |
| 15 | (new) Refresh | `[standard]` Refresh every 60 seconds while visible; "Làm mới" beside "Cập nhật lúc HH:mm". | Ops dashboards refresh on a timer and let the user force it (common practice). |
| 16 | (new) Who confirms cash and refunds at the counter? | `[standard]` Pharmacist only. A Pharmacy Manager reads the list; Platform Admin does not open the Counter overview (BR-AUTH-010). Owner may change: who may take cash is a policy choice. | Segregation of duties: the person who runs the platform does not handle the cash drawer. |
| 18 | (new) Product count | `[standard]` Active products only, the same filter as the product list. | Products are deactivated, not deleted; the count matches what staff and customers see. |
| 19 | (new) Which roles may call the APIs? | `[standard]` The dashboard API admits only the roles its screen admits, enforced in the service. | Hiding a menu is not a control (least privilege). |
| 20 | (new) Name of the page | `[standard]` "Counter overview" (Vietnamese "Tổng quan quầy") everywhere. The route `/pharmacist-overview` stays, so bookmarks keep working. | Pharmacy Managers read this page too, so "Pharmacist" is the wrong name. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G2 | Low stock: a balance with 0 < available ≤ 10 (decision 12). | Counts every balance row with available ≤ 10 (`lowStockBatchCount`), so a row with nothing available counts too. BR-REPORT-002 states the upper bound only. | `operations-repository.ts` (`dashboard()`); BR-REPORT-002 must be aligned |
| G3 | Expiring: batches with on-hand stock expiring by today + 30 days (decision 13). | The unscoped count takes every batch dated within 30 days, with or without stock (`isExpiringBatch`). The scoped count takes batches a balance row references, with or without stock (`scopedExpiringBatchCount`). BR-REPORT-003 states neither on-hand stock nor the lower bound. | `operations-repository.ts` (`isExpiringBatch`, `scopedExpiringBatchCount`); BR-REPORT-003 must be aligned |
| G5 | A failed dashboard request shows "—" in every tile, with the alert (decision 4). | `numberValue` falls back to 0, so `formatQuantity(undefined)` renders "0" beside the alert. | `apps/staff-web/src/staff-api.ts`; `dashboard-section.tsx` |
| G6 | A live 0 is 0; an unanswered figure is "—", never a projection value shown as current (decision 7). | For a network-wide reader, `live.x.length \|\| counters.y \|\| 0` takes the projection when the live figure is 0. An unreachable service returns no rows, so the stale projection shows. | `operations-repository.ts` (`dashboard()`, `fetchRows`, `readJson`) |
| G7 | A site selector on the dashboard (decision 3). | No selector. The dashboard request sends no `siteId`, though the API honours an employee's `siteId`. | `dashboard-section.tsx`; BR-REPORT-001 already names a selected site |
| G8 | Each attention tile links to its worklist, keeping the site (decision 16). | Tiles are display only. | `dashboard-section.tsx` |
| G9 | "Đơn thuốc đang mở" is not shown to Warehouse Staff (decision 6). | The attention list is unconditional. | `dashboard-section.tsx`; [user guide](../user-guide.md#dashboard) must match |
| G10 | (resolved 2026-11-03) Warehouse Staff see inventory and procurement actions only in recent activity (decision 14). | Resolved: `dashboard()` takes the action families from the route and filters with `action ILIKE '<family>.%'`. | `operations-repository.ts` (`dashboard()`, `actionFamilyFilter`); `operations-access.ts` (`dashboardActionFamilies`) |
| G11 | "Dữ liệu tới HH:mm" from the projection lag (decision 14). | `projectionLag` is returned and not rendered. | `operations-repository.ts`; `dashboard-section.tsx` |
| G12 | Refresh every 60 seconds while visible, and a "Làm mới" button (decision 15). | `refetchOnWindowFocus: false` globally; no refetch interval on this query; no button. | `apps/staff-web/src/query-client.ts`; `dashboard-section.tsx` |
| G14 | The attention block of the Counter overview (US5). | Not rendered. The `pharmacistOverview.*` keys in `i18n.ts` are used by no component. | `apps/staff-web/src/App.tsx` (`case "pharmacistOverview"`); `apps/staff-web/src/i18n.ts` |
| G15 | One name for the page: "Counter overview" / "Tổng quan quầy" (decision 20). | Sidebar "Pharmacist overview" (`App.tsx`); Vietnamese "Tổng quan quầy" (`i18n/shell.ts`); English key `nav.pharmacistOverview` reads "Counter overview" (`i18n.ts`). The [user guide](../user-guide.md) Roles table, landing note and walkthrough step 6 say "Pharmacist overview". | `App.tsx`; `i18n/shell.ts`; `i18n.ts`; `docs/user-guide.md` |
| G21 | Unused `dashboard.*` copy is removed (decision 10). | The `dashboard.*` keys are still in `i18n.ts` in both languages. `dashboard-section.tsx` uses none of them. | `apps/staff-web/src/i18n.ts` |
| G22 | The data-integrity rule is in business-rules.md section 17 (decision 11). | Section 17 has no rule that admin screens show real data or that a failed figure is shown as failed. | `docs/business-rules.md` section 17 |
| G23 | The API guide states that the dashboard figures are the target contract, with HTTP reads marked as a deviation (decision 7). | `docs/api-guide.md`, "Query projections", says these endpoints "read only `operations-query-service` projections" with no deviation note. `docs/architecture.md` already calls the HTTP reads a deviation. | `docs/api-guide.md` (query projections) |
| G24 | Figures come from operations-query's own projections (ADR 0003; design 0001). | `loadLiveOperations` and `loadCounts` call the catalog, inventory and sales services over HTTP. | `apps/operations-query-service/src/modules/operations-repository.ts` |
| G25 | Pharmacy Manager reads the Counter overview (US6). | `sectionRoles.pharmacistOverview` lists Pharmacist only, so Pharmacy Manager is refused the page. The shell role table gives Pharmacy Manager "—" for Pharmacist overview, which conflicts with this row. Platform Admin is refused the page too, as BR-AUTH-010 requires. | `apps/staff-web/src/permissions/section-access.ts`; [shell spec](staff-shell-sign-in-and-navigation.md) role table. |
