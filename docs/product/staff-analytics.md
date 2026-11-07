# Analytics

- **Status:** Draft
- **App and route:** staff-web, `/analytics` (sidebar "Phân tích"), with the open tab in `?tab=` and the month of **Mục tiêu** in `?month=`
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-30

Tags: `[owner]` a recorded owner decision; `[observed]` read from the code; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[owner]` 2026-10-28: managers and Platform Admin need a period view: revenue, order count, average order value and gross profit against the previous period, by site and channel, with the health of stock beside it.
- `[standard]` 2026-10-30: the period also has to say where the revenue came from, so the page divides it across sites, products, categories and the prescription split.
- `[standard]` The [dashboard](staff-dashboard-and-counter-overview.md) answers "what needs action now" with counts. This page answers "how did the period go", so the two stay separate. It reads only and changes no record.
- `[standard]` 2026-10-30: the period report is long, so the page is a tabbed workspace of five tabs, and a tab reads its data when it is opened, the way an ERP splits a report into workspaces instead of one endless scroll. The four analytical tabs share one set of filters; the targets tab keeps its own month.

## Users and entry points

Platform Admin (read only) and Pharmacy Manager (`sectionRoles.analytics`; the service refuses other roles). A site-scoped manager sees their sites only; Platform Admin sees every site. The page has no write, so Platform Admin loses nothing. Pharmacist and Warehouse Staff have no entry.

## User stories and acceptance criteria

### US1. As a manager, I choose a period, a site and a channel

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - The period has the presets "7 ngày", "30 ngày", "90 ngày", "Tháng này" and two dates; the choice, the site and the channel are in the URL. The server refuses a period over 366 days.
  - The period, the site and the channel are shared by the four analytical tabs, so a choice made on one of them holds when another opens; the **Mục tiêu** tab has the month picker of US7 instead (US8).
  - The site selector lists the employee's sites (default all of them); the channel is "Tất cả", "Quầy" or "Trực tuyến".
  - A site outside the employee's assignment answers 403 `site_access_denied`.

### US2. As a manager, I read the sales KPIs against the previous period

- Source: `[owner]` 2026-10-28; definitions `[standard]` (BR-REPORT-008).
- Accepted when:
  - The **Tổng quan** tab's tiles show revenue, number of orders and average order value; each shows the previous period of the same length and the change in percent, or "—" when the previous value is 0.
  - A sale is an online order or counter prescription with a `Paid` invoice, counted in the period and site of the order or prescription. A refunded invoice is not revenue.
  - The channel filter narrows these figures; the tab's channel table always shows both channels for the period.
  - Gross profit is revenue less the purchase cost of goods for the sales whose goods all have a cost recorded on a receipt (BR-REPORT-009, BR-PROC-009). The tile shows the previous period and the change, and says "Tính trên N% doanh thu có giá nhập" when part of the revenue has no cost. It shows "—" with "Chưa có giá nhập cho các đơn trong kỳ" when no sale of the period has one, never 0.
  - Test: pay one online order and one counter prescription; revenue is their sum, the orders tile is 2, the channel filter "Quầy" shows 1; refund one and it leaves revenue.

### US3. As a manager, I read inventory health

- Source: `[owner]` 2026-10-28; definitions `[standard]` (BR-REPORT-010, 011).
- Accepted when:
  - The **Tồn kho** tab shows stock turnover, days of inventory, stockout rate (labelled as the state now), dead stock (products, quantity, value; the top items listed), stock value by site and the expiry buckets: expired, within 30, 31 to 60 and 61 to 90 days, each with products, quantity and value.
  - A note says the channel does not change these figures.
  - A figure that cannot be answered shows "—"; a failed read shows the red alert in the tab and "—" in every tile of it, never 0.
  - Products with no published price add nothing to a value, and their number is shown.

### US4. As a manager, I read where the period's revenue came from

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-012 to 015.
- Accepted when:
  - The **Doanh thu** tab holds the five tables below and no KPI tile: the tiles belong to **Tổng quan** (US2).
  - **Doanh thu theo cơ sở** lists every site with a sale in the period: revenue, orders and average order value, highest revenue first. Revenue is the invoice amounts, so the rows add up to the revenue tile.
  - **Sản phẩm bán chạy** lists the ten products with the highest goods revenue and each one's share of goods revenue. The note shows the goods revenue total.
  - **Phân nhóm ABC** lists three rows, A, B and C, each with the number of products, goods revenue and share of goods revenue. A holds the products that complete 80% of goods revenue, B the next 15% and C the rest; the product that crosses a cut-off stays in the class it completes, so A is at least 80% and A+B at least 95%. Products with no goods revenue enter no class, and a period with no goods shows three empty rows with "—" shares. The channel filter applies.
  - **Doanh thu theo nhóm hàng** lists the catalog category of each sold product and its share of goods revenue. A product with no category is "Chưa phân nhóm". Categories are matched ignoring case and surrounding spaces.
  - **Thuốc kê đơn và không kê đơn** lists both rows (at 0 when the period sold none), and an "Chưa xác định" row only when a sold product is no longer in the catalog.
  - The delivery fee is revenue but belongs to no product: it is in the site rows and the revenue tile, not in the product tables, whose shares are of goods revenue. The tab says so.
  - The period, site and channel filters apply to every table. An empty period shows empty tables and "—" shares. A failed read fails the tab, never a partial answer.
  - Test: pay an online order with a delivery fee and one product, and a counter prescription with a prescription-only product. The site rows sum to the revenue tile, the delivery fee appears in no product row, the prescription-only product lands in "Thuốc kê đơn", and the two shares sum to 100% of goods revenue.

### US5. As a manager, I read who bought in the period

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-016.
- Accepted when:
  - The **Khách hàng** tab shows khách đã nhận diện (kèm số lần mua mỗi khách), khách mua 1 lần, khách mua lặp lại, và doanh thu từ khách đã nhận diện kèm tỷ trọng doanh thu.
  - A sale is identified by the `customerId` on the **sales document**: an online order always has one, a counter prescription only when the pharmacist linked the customer, and a walk-in sale never does. The tab says so.
  - One-time means exactly one paid sale in the period, repeat means two or more; the period, site and channel filters apply.
  - With no identified customer the counts show 0, the frequency and share show "—"; a failed read fails the tab, never a partial answer.
  - Test: two paid orders of one customer and one of another in the period, plus one walk-in counter sale: 2 identified customers, 1 one-time, 1 repeat, 1.5 purchases per customer, and the share excludes the walk-in sale.

### US6. As a manager, I tell new customers from returning ones

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-017.
- Accepted when:
  - **Khách hàng** also shows **Khách mới** and **Khách quay lại**; the two counts add up to the identified customers.
  - New means the customer's first paid purchase **ever** falls inside the period; returning means it falls before it. A refund keeps the first purchase date, so a refunded first sale still makes the customer returning next time.
  - The period, site and channel choose the customers; the site filter never moves the first-purchase date. A customer who bought at another site before the period is returning.
  - Without a first-purchase date (data from before the column, before the backfill) the customer counts as new rather than failing the page.
  - Test: one customer paid an order before the period and one inside, another customer's first paid order is inside: 1 returning, 1 new, and the two add up to 2 identified.

### US7. As a manager, I set a monthly target and watch the month against it

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-018.
- Accepted when:
  - The **Mục tiêu** tab has its own month picker, independent of the page's 7/30/90-day period, and shows one row per site the caller may see: the target, the month's paid revenue, and the share of the target reached.
  - The month is in the URL (`?month=YYYY-MM`), so the tab's link reproduces the month as well as the tab.
  - A site without a target shows "Chưa đặt" and a blank share, never 0%; the totals add the visible rows.
  - A Pharmacy Manager sets or changes a site's target for the picked month from the row; the write is refused outside their sites and for every other role, Platform Admin included. The action is hidden, not disabled, when the role may not write.
  - The revenue follows the site filter of the page and counts every channel, delivery fee included; it is the paid revenue of sales created in the month.
  - A failed read shows an error in the section and no stale target or revenue.
  - The tab reads `GET /api/dashboard/sales-targets` only; the four analytical sections carry no target, and the targets tab sends no analytics request.
  - The targets read is never cached: the tab reads it on each open and each **Làm mới**, and the tab re-reads it after a target is set, so a new amount shows at once rather than after a cache window.
  - Test: set 1,000,000 ₫ for a site with 500,000 ₫ paid in the month: the row shows 50%; change it to 400,000 ₫ and the same row shows 125%; a site with no target stays "Chưa đặt".

### US8. As a manager, I open only the tab I need

- Source: `[standard]` 2026-10-30; [design 0009](../design/0009-analytics-tabbed-workspace.md).
- Accepted when:
  - The page has five tabs in this order: **Tổng quan**, **Doanh thu**, **Khách hàng**, **Tồn kho**, **Mục tiêu**. `/analytics` opens **Tổng quan**; `?tab=overview|revenue|customers|inventory|targets` opens that tab, and an unknown value opens **Tổng quan**.
  - The tab is in the URL beside the filters, so the browser's back and forward move between tabs and a copied link reproduces the tab with its period, site and channel.
  - Only the open tab renders and only it sends its request. A tab never opened sends none; a tab opened earlier in the visit reuses its cached answer while it is fresh (30 seconds), and after that reopening it may read again. A filter change reads only the open tab.
  - A filter change (US1) reloads the open tab only. **Làm mới** reloads the open tab only; nothing polls in the background and no tab reloads another.
  - Each tab has its own loading skeleton and its own error alert; a failing tab shows its alert and "—" figures without blanking another tab. A failing **Mục tiêu** tab leaves the four analytical tabs usable.
  - Each analytical tab shows the time of its own response (`generatedAt`) as "Cập nhật lúc …" with "Số liệu có thể cũ tối đa 30 giây." above its content. Because the server may answer from a 30-second cache, that time reads at most 30 seconds behind the clock ([design 0009](../design/0009-analytics-tabbed-workspace.md)). **Mục tiêu** has no such stamp, because `GET /api/dashboard/sales-targets` carries no `generatedAt`; it keeps its own **Làm mới**.
  - Refreshing an analytical tab inside those 30 seconds is served by the server cache instead of repeating the reads to the other services, so holding F5 does not multiply the load on them. **Mục tiêu** is not cached and is read on every refresh.

## Contents and behavior

The page is a tabbed workspace: one tab is open at a time, and it alone renders and reads its data (US8).

| Tab | `?tab=` | Contents |
| --- | --- | --- |
| **Tổng quan** (default) | `overview` | Revenue, orders, average order value and gross profit against the previous period, and the channel table with both channels (US2). |
| **Doanh thu** | `revenue` | Revenue by site, top products, ABC classification, revenue by product group, and the prescription and over-the-counter split (US4). |
| **Khách hàng** | `customers` | Identified, new, returning, one-time and repeat customers, purchases per customer, and revenue from identified customers with its share (US5, US6). |
| **Tồn kho** | `inventory` | Turnover, days of inventory, stockout rate, dead stock counts, quantity and value, total stock value, stock value by site, the expiry buckets and the dead-stock items (US3). |
| **Mục tiêu** | `targets` | The month's paid revenue against each visible site's target, with the month picker (US7). |

- **Filters.** **Tổng quan**, **Doanh thu**, **Khách hàng** and **Tồn kho** share the period, site and channel controls of US1; the choice stays with the manager while moving between them. **Mục tiêu** replaces them with its month picker (`?month=YYYY-MM`), and its site filter follows the shared site. The page's URL keys are `?tab=`, `?period=`, `?from=`, `?to=`, `?site=` (`all` or a site id), `?channel=` and `?month=`; only the API parameter is called `siteId`.
- **Requests.** Each analytical tab asks one section of `GET /api/dashboard/analytics?section=…` with `from`, `to`, `channel` and the optional `siteId`: `section=overview` answers `kpis` and `channels`, `section=revenue` answers `breakdown`, `section=customers` answers `customers`, `section=inventory` answers `inventory` ([API guide](../api-guide.md#query-projections)). Every answer carries the same envelope: `section`, `currency` ("VND"), `generatedAt`, `period`, `previousPeriod`, `siteId` and `channel`, plus the one field of the section. A missing or unknown `section` is refused with 400; the site scope and the 366-day cap answer as in US1.
- **Targets.** **Mục tiêu** reads `GET /api/dashboard/sales-targets` with the month, its bounds and the site, and sends no analytics request. The analytics sections carry no target.
- **Loading and failure.** A tab shows skeletons while its own request runs, and a failed request fails that tab alone: the red alert and "—" in its figures, never 0 and never a partial answer from the other tabs.
- **Freshness.** Every analytical answer carries `generatedAt`, which its tab shows as "Cập nhật lúc …" beside "Số liệu có thể cũ tối đa 30 giây."; the targets answer carries no time and **Mục tiêu** shows none. `operations-query-service` keeps each of the four sections for 30 seconds and serves that stored answer to a repeat or concurrent request, so a refresh, or many managers refreshing, costs the other services one read per section per 30 seconds per instance rather than one per browser ([design 0009](../design/0009-analytics-tabbed-workspace.md)). The targets report is not cached: `GET /api/dashboard/sales-targets` is read on every open and refresh, so a target just set shows on the next read.

## States

- **Loading:** skeleton tiles and table rows on the open tab only; the tab strip and the other tabs stay usable.
- **Error:** the red alert inside the open tab and "—" in its figures. The other tabs keep what they hold.
- **Empty period:** a true zero shows "0" (orders, revenue); ratios with a zero denominator show "—".
- **Cached answer:** a repeat request inside 30 seconds may show the same figures, and on an analytical tab the same "Cập nhật lúc" time, as the last one; that is the cache, not a failed refresh. **Mục tiêu** never answers from the cache.

## Out of scope

- `[standard]` Charts and trend lines; a gross profit estimated from a margin for sales without a recorded cost; exports.
- `[standard]` Any write. Plans for an alert are made on [Action plans](staff-action-plans.md).

## Rules and designs

- [BR-REPORT-008 to 018](../business-rules.md), BR-FIN-002, BR-FIN-003, BR-AUTH-004; [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md), [design 0009](../design/0009-analytics-tabbed-workspace.md).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Where does the sale date come from? | `[standard]` The creation date of the order or prescription. | Both carry the site; an invoice carries none. |
| 2 | Gross profit without a cost? | `[standard]` Counted only over sales whose goods are all costed; the share of revenue covered is shown; none costed shows "—". | A guessed margin would be a made-up figure (BR-FIN-003). Owner may change: make the cost mandatory on receipts, or backfill the opening stock. |
| 3 | Stockout rate over the period? | `[standard]` The state now. | The system keeps no daily stock snapshots. |
| 4 | Dead stock window | `[standard]` 90 days without a ledger movement. Owner may change. | A common retail threshold; it is stock policy. |
| 5 | Stock value basis | `[standard]` Today's published selling price, as in Finance. | The catalog keeps no purchase cost. |
| 6 | What is site revenue? | `[standard]` The invoice amounts of the site's sales, the delivery fee included, so the rows add up to the revenue tile. | One number for "how much did this site take"; goods revenue is a separate, product-only figure. |
| 7 | Where does the delivery fee go in the product tables? | `[standard]` Nowhere: it has no product, and guessing an allocation would be a made-up figure. | BR-FIN-003: no guessed money. The page states the basis of every share. |
| 8 | Which product grouping is shown? | `[standard]` The catalog's category as it stands today, and the current `prescriptionRequired` flag. Owner may change to a fixed category list. | The system does not snapshot either on the sale; the limit is stated on the page. |
| 9 | How many products in the top list? | `[standard]` Ten. | Enough to see the shape of the period without a full product report. |
| 10 | Which sites appear? | `[standard]` Every site with a sale in the period; a sale with no site is one unnamed row, visible to Platform Admin only. | Site scope (BR-AUTH-004) keeps an unnamed sale away from a site-scoped manager. |
| 11 | Rank the top list by revenue or units? | `[standard]` Revenue. | A product sells in several units (viên, hộp, chai), so a unit total would add quantities that are not comparable; revenue is the one figure every line carries. |
| 12 | What are the ABC cut-offs? | `[standard]` 80% and 95% of cumulative goods revenue in the period; the crossing product stays in the class it completes. | The classic ABC shape; using the period's own revenue keeps the classes tied to the chosen filter. |
| 13 | Which customer field identifies the buyer? | `[standard]` The `customerId` on the sales document, never the one on the invoice. | A counter invoice stores the staff member who created it, so an invoice-based count would treat the pharmacist as the buyer. A walk-in sale stays unidentified. |
| 14 | What makes a customer new? | `[standard]` Their first paid purchase on the whole system falls inside the period. The site filter chooses the customers, not the date. | A customer who bought at another site last month is not new at this one; only the first purchase ever says so. |
| 15 | Where do sales targets live, and why not in the analytics service? | `[standard]` In sales-service, one `sales_targets` row per (site, month); operations-query composes the read-only report. | ADR 0001 keeps operations-query a read model. Sales owns the revenue the goal is measured against and already has the write path, so the target follows it; a manager-only write and the site scope stay in one service. |
| 16 | One long page or tabs? | `[standard]` Five tabs, one open at a time, the open tab in `?tab=`, and a tab reads its section only when opened. | A manager arrives with one question ("did we make the month", "what is expiring"), and a tabbed workspace puts that answer on screen without reading four other reports. ERP convention: one workspace per question, filters shared. |
| 17 | Why a server cache if the tabs already load lazily? | `[standard]` A 30-second cache per analytical section in `operations-query-service`, so a refresh does not repeat the fan-out. The targets report is deliberately left uncached. | Lazy tabs lower what one visit reads; they do not lower what a refresh, or fifty managers refreshing, reads, and the analytics read fans out to four services. A cached targets report would answer the old amount right after a manager changed it, so that one read stays direct. See [design 0009](../design/0009-analytics-tabbed-workspace.md). |

## Gaps against the code (2026-10-30)

None.
