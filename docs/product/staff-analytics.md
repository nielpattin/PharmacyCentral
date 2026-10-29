# Analytics

- **Status:** Draft
- **App and route:** staff-web, `/analytics` (sidebar "Phân tích")
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-28

Tags: `[owner]` a recorded owner decision; `[observed]` read from the code; `[standard]` a decision from industry practice. See [README](README.md).

## Purpose

- `[owner]` 2026-10-28: managers and Platform Admin need a period view: revenue, order count, average order value and gross profit against the previous period, by site and channel, with the health of stock beside it.
- `[standard]` The [dashboard](staff-dashboard-and-reporting.md) answers "what needs action now" with counts. This page answers "how did the period go", so the two stay separate. It reads only and changes no record.

## Users and entry points

Platform Admin and Pharmacy Manager (`sectionRoles.analytics`; the edge and the service refuse other roles). A site-scoped manager sees their sites only. Pharmacist and Warehouse Staff have no entry.

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

## Contents and behavior

Controls (US1), sales KPI tiles and channel table (US2), inventory health tiles and tables (US3). Each of the three reads is a separate service call behind one request, `GET /api/dashboard/analytics` ([API guide](../api-guide.md#query-projections)); one failed read fails the page rather than showing a partial answer.

## States

- **Loading:** skeleton tiles. **Error:** the red alert and "—" in every tile. **Empty period:** a true zero shows "0" (orders, revenue); ratios with a zero denominator show "—".

## Out of scope

- `[standard]` Charts and trend lines; a gross profit estimated from a margin for sales without a recorded cost; exports.
- `[standard]` Any write. Plans for an alert are made on [Action plans](staff-action-plans.md).

## Rules and designs

- [BR-REPORT-008 to 011](../business-rules.md), BR-FIN-002, BR-FIN-003, BR-AUTH-004; [design 0007](../design/0007-period-analytics-replenishment-and-action-plans.md).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Where does the sale date come from? | `[standard]` The creation date of the order or prescription. | Both carry the site; an invoice carries none. |
| 2 | Gross profit without a cost? | `[standard]` Counted only over sales whose goods are all costed; the share of revenue covered is shown; none costed shows "—". | A guessed margin would be a made-up figure (BR-FIN-003). Owner may change: make the cost mandatory on receipts, or backfill the opening stock. |
| 3 | Stockout rate over the period? | `[standard]` The state now. | The system keeps no daily stock snapshots. |
| 4 | Dead stock window | `[standard]` 90 days without a ledger movement. Owner may change. | A common retail threshold; it is stock policy. |
| 5 | Stock value basis | `[standard]` Today's published selling price, as in Finance. | The catalog keeps no purchase cost. |

## Gaps against the code (2026-10-28)

None.
