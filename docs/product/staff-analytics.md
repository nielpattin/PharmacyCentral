# Analytics

- **Status:** Draft
- **App and route:** staff-web, `/analytics` (sidebar "Phân tích")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-30

Tags: `[owner]` a recorded owner decision; `[observed]` read from the code; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[owner]` 2026-10-28: managers and Platform Admin need a period view: revenue, order count, average order value and gross profit against the previous period, by site and channel, with the health of stock beside it.
- `[standard]` 2026-10-30: the period also has to say where the revenue came from, so the page divides it across sites, products, categories and the prescription split.
- `[standard]` The [dashboard](staff-dashboard-and-reporting.md) answers "what needs action now" with counts. This page answers "how did the period go", so the two stay separate. It reads only and changes no record.

## Users and entry points

Platform Admin (read only) and Pharmacy Manager (`sectionRoles.analytics`; the edge and the service refuse other roles). A site-scoped manager sees their sites only; Platform Admin sees every site. The page has no write, so Platform Admin loses nothing. Pharmacist and Warehouse Staff have no entry.

## User stories and acceptance criteria

### US1. As a manager, I choose a period, a site and a channel

- Source: `[owner]` 2026-10-28.
- Accepted when:
  - The period has the presets "7 ngày", "30 ngày", "90 ngày", "Tháng này" and two dates; the choice, the site and the channel are in the URL. The server refuses a period over 366 days.
  - The site selector lists the employee's sites (default all of them); the channel is "Tất cả", "Quầy" or "Trực tuyến".
  - A site outside the employee's assignment answers 403 `site_access_denied`.

### US2. As a manager, I read the sales KPIs against the previous period

- Source: `[owner]` 2026-10-28; definitions `[standard]` (BR-REPORT-008).
- Accepted when:
  - Tiles show revenue, number of orders and average order value; each shows the previous period of the same length and the change in percent, or "—" when the previous value is 0.
  - A sale is an online order or counter prescription with a `Paid` invoice, counted in the period and site of the order or prescription. A refunded invoice is not revenue.
  - The channel filter narrows these figures; a channel table always shows both channels for the period.
  - Gross profit is revenue less the purchase cost of goods for the sales whose goods all have a cost recorded on a receipt (BR-REPORT-009, BR-PROC-009). The tile shows the previous period and the change, and says "Tính trên N% doanh thu có giá nhập" when part of the revenue has no cost. It shows "—" with "Chưa có giá nhập cho các đơn trong kỳ" when no sale of the period has one, never 0.
  - Test: pay one online order and one counter prescription; revenue is their sum, the orders tile is 2, the channel filter "Quầy" shows 1; refund one and it leaves revenue.

### US3. As a manager, I read inventory health

- Source: `[owner]` 2026-10-28; definitions `[standard]` (BR-REPORT-010, 011).
- Accepted when:
  - The page shows stock turnover, days of inventory, stockout rate (labelled as the state now), dead stock (products, quantity, value; the top items listed), stock value by site and the expiry buckets: expired, within 30, 31 to 60 and 61 to 90 days, each with products, quantity and value.
  - A note says the channel does not change these figures.
  - A figure that cannot be answered shows "—"; a failed read shows the red alert and "—" in every tile, never 0.
  - Products with no published price add nothing to a value, and their number is shown.

### US4. As a manager, I read where the period's revenue came from

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-012 to 015.
- Accepted when:
  - **Doanh thu theo cơ sở** lists every site with a sale in the period: revenue, orders and average order value, highest revenue first. Revenue is the invoice amounts, so the rows add up to the revenue tile.
  - **Sản phẩm bán chạy** lists the ten products with the highest goods revenue and each one's share of goods revenue. The note shows the goods revenue total.
  - **Phân nhóm ABC** lists three rows, A, B and C, each with the number of products, goods revenue and share of goods revenue. A holds the products that complete 80% of goods revenue, B the next 15% and C the rest; the product that crosses a cut-off stays in the class it completes, so A is at least 80% and A+B at least 95%. Products with no goods revenue enter no class, and a period with no goods shows three empty rows with "—" shares. The channel filter applies.
  - **Doanh thu theo nhóm hàng** lists the catalog category of each sold product and its share of goods revenue. A product with no category is "Chưa phân nhóm". Categories are matched ignoring case and surrounding spaces.
  - **Thuốc kê đơn và không kê đơn** lists both rows (at 0 when the period sold none), and an "Chưa xác định" row only when a sold product is no longer in the catalog.
  - The delivery fee is revenue but belongs to no product: it is in the site rows and the revenue tile, not in the product tables, whose shares are of goods revenue. The page says so.
  - The period, site and channel filters apply to every table. An empty period shows empty tables and "—" shares. A failed read fails the page, never a partial answer.
  - Test: pay an online order with a delivery fee and one product, and a counter prescription with a prescription-only product. The site rows sum to the revenue tile, the delivery fee appears in no product row, the prescription-only product lands in "Thuốc kê đơn", and the two shares sum to 100% of goods revenue.

### US5. As a manager, I read who bought in the period

- Source: `[standard]` 2026-10-30; definitions BR-REPORT-016.
- Accepted when:
  - The page shows **Khách hàng**: khách đã nhận diện (kèm số lần mua mỗi khách), khách mua 1 lần, khách mua lặp lại, và doanh thu từ khách đã nhận diện kèm tỷ trọng doanh thu.
  - A sale is identified by the `customerId` on the **sales document**: an online order always has one, a counter prescription only when the pharmacist linked the customer, and a walk-in sale never does. The page says so.
  - One-time means exactly one paid sale in the period, repeat means two or more; the period, site and channel filters apply.
  - With no identified customer the counts show 0, the frequency and share show "—"; a failed read fails the page, never a partial answer.
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
  - **Mục tiêu doanh số** has its own month picker, independent of the page's 7/30/90-day period, and shows one row per site the caller may see: the target, the month's paid revenue, and the share of the target reached.
  - A site without a target shows "Chưa đặt" and a blank share, never 0%; the totals add the visible rows.
  - A Pharmacy Manager sets or changes a site's target for the picked month from the row; the write is refused outside their sites and for every other role, Platform Admin included. The action is hidden, not disabled, when the role may not write.
  - The revenue follows the site filter of the page and counts every channel, delivery fee included; it is the paid revenue of sales created in the month.
  - A failed read shows an error in the section and no stale target or revenue.
  - Test: set 1,000,000 ₫ for a site with 500,000 ₫ paid in the month: the row shows 50%; change it to 400,000 ₫ and the same row shows 125%; a site with no target stays "Chưa đặt".

## Contents and behavior

Controls (US1), sales KPI tiles and channel table (US2), the customer tiles (US5 and US6), the breakdown tables (US4), inventory health tiles and tables (US3), and the monthly sales targets (US7). The analytics figures come from one request, `GET /api/dashboard/analytics`, and the targets from `GET /api/dashboard/sales-targets` ([API guide](../api-guide.md#query-projections)); one failed read fails its own part rather than showing a partial answer.

## States

- **Loading:** skeleton tiles. **Error:** the red alert and "—" in every tile. **Empty period:** a true zero shows "0" (orders, revenue); ratios with a zero denominator show "—".

## Out of scope

- `[standard]` Charts and trend lines; a gross profit estimated from a margin for sales without a recorded cost; exports.
- `[standard]` Any write. Plans for an alert are made on [Action plans](staff-action-plans.md).

## Rules and designs

- [BR-REPORT-008 to 018](../business-rules.md), BR-FIN-002, BR-FIN-003, BR-AUTH-004; [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md).

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

## Gaps against the code (2026-10-30)

None.
