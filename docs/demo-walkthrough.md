# Demo walkthrough

A script for presenting Pharmacy Central from a fresh demo dataset: who signs in, what to open, and what is on screen. Every record named here comes from `pnpm run demo:reset` (seed A plus seed B, see "Seeds" in [the runbook](runbook.md)). Screen names are the Vietnamese titles the apps show.

## Before you present

1. Container mode: `pnpm run local:up`, then `pnpm run urls:up` once per session.
2. **Run `pnpm run demo:reset` the same day, ideally the morning of the demo.** It takes about three minutes. It wipes the seven service databases and the search index, migrates, runs both seeds, and restarts `inventory-service` so the automatic action plans exist.
3. Open the apps by their named URLs, never `localhost`: `http://staff.pharmacy.localhost` and `http://customer.pharmacy.localhost`. A browser holds one staff session at a time, so sign out between roles (or use a second profile).
4. Passwords: `ADMIN_PASSWORD` for the admin, `DEMO_ACCOUNT_PASSWORD` for every other account, both in `.env`.

| Role | Email | Site | App |
| --- | --- | --- | --- |
| Platform Admin | `admin@pharmacycentral.vn` | all (read only) | staff |
| Pharmacy Manager | `manager@pharmacycentral.vn` | every site | staff |
| Pharmacy Manager (second) | `manager2@pharmacycentral.vn` | every site | staff |
| Pharmacist | `pharmacist@pharmacycentral.vn` | `SITE-RTL` | staff |
| Warehouse Staff | `warehouse@pharmacycentral.vn` | `SITE-WH` (the warehouse), `SITE-HUB`, `SITE-RTL` to `SITE-RTL5` | staff |
| Customer | `khachhang@pharmacycentral.vn` | none | customer |

### Why it must be reseeded on the day

Every date in the dataset is relative to the day it is seeded: batch expiries, the 60 days of sales ending yesterday, purchase and receipt dates, plan due dates. Nothing is written as a calendar date. The reverse is also true: after seeding, the data ages with the clock. A batch that expires in 6 days is in 5 tomorrow and expired in a week, the newest sale gets older, and a 7-day analytics window slowly empties. `pnpm run seed:demo` prints a warning when it finds a history that is a day or more old. Reseed instead of fixing records by hand.

## What the dataset holds

| Area | Content |
| --- | --- |
| Catalog | 54 products with photos: 36 medicines, 18 supplies and devices. 14 are prescription-only. 7 have no price (shown as "Liên hệ báo giá"). |
| Sales | About 200 sales over the last 60 days (206 in the last run; the seed prints the exact count): counter prescriptions paid in cash, online orders paid by SePay QR or cash on delivery, pickup and delivery, a few cancelled and refunded. Volume grows over the period, higher on weekends. |
| Purchasing | 5 approved orders (`PO-HIST-001` to `005`) received in full with a unit cost per line. `PO-DEMO-001` is partly received, `PO-DEMO-002` and `PO-WH-001` wait for approval, `PO-DEMO-003` is cancelled. |
| Expiry | Batches that expire in 6, 12, 20, 27 and 45 days, and one already expired. |
| Stock health | Dead stock (no movement for over 90 days), five shop products that end the period short against their sales, 7 products with stock but no price. |
| Warehouse | Goods receipts `GR-WH-001` to `003`, replenishment, returns, a posted and an open stocktake, adjustments, all in several states. |
| Action plans | 29 open plans raised by the system (the last run): 5 expiry, 10 dead stock, 7 price warnings, 7 replenishment. |
| Customer | The demo shopper has dozens of orders in every state, one out for delivery, and a cart with one ticked and two unticked lines. |
| Search | Six approved synonym groups and one (`ho khan, ho không đờm, ho rát cổ`) waiting for approval. |

## 1. Customer (Customer Web)

Sign in at `/tai-khoan` as `khachhang@pharmacycentral.vn`.

1. **Home and catalog**: the menu groups products (Thuốc, Thực phẩm chức năng, Thiết bị y tế). Every product has a photo. A prescription-only product shows a disabled "Cần đơn thuốc" button; an unpriced one shows "Liên hệ báo giá".
2. **Cart (`/don-hang`, tab "Đặt hàng")**: the cart already has three lines, only the first ticked. Tick another, reload the page, and the ticks stay. Only ticked lines go into the order.
3. **Place an order**: pick pickup at the shop, or delivery to an address in Kim Mã or Chùa Láng (the fee comes from the server). Pay by SePay QR or cash. If the browser has no WebGL the map shows an unavailable notice and the rest still works.
4. **Track it (tab "Đơn của tôi")**: the featured card is the order that is out for delivery, with the stepper. Below it are the other states, filterable by "Đang xử lý", "Hoàn tất", "Đã huỷ".
5. **Shopping assistant and "Gửi đơn thuốc"**: they need an AI provider set up (see Platform Admin, step 4). Without one they answer that the assistant is unavailable.

## 2. Pharmacist (Staff Web)

1. **Tổng quan quầy**: the counter at a glance.
2. **Đơn thuốc**: `Trần Văn Bình` is waiting. Open it and dispense it, then create the invoice and confirm cash. `Lê Thị Cẩm` is already dispensed, `Phạm Quốc Dũng` cancelled, and the counter sales of the last 60 days fill the rest of the list.
3. **Đơn hàng online**: the customer's order from step 1 appears here. Move it forward (confirm, prepare, ready, deliver, complete). Orders in each of those states are already in the list.
4. **Kế hoạch hành động**: the plans owned by this pharmacist. Open a plan's title for the drawer with the next step and a link to the work. Change its status (Đang xử lý, Hoàn tất). The pharmacist can change a status only.
5. **Từ đồng nghĩa tìm kiếm**: approve the waiting group. The manager submitted it, and nobody approves their own submission.

## 3. Pharmacy Manager (Staff Web)

1. **Bảng điều khiển**: shop figures for today.
2. **Phân tích**: pick the last 30 or 60 days. Revenue, orders and average order value against the previous period, the counter and online split, and gross profit with the share of revenue it covers (about two thirds, because opening stock carries no cost). Below: stock turnover, days of inventory, stock value (with the count of products missing a price), expiry buckets, and dead stock.
3. **Kế hoạch hành động**: the manager reassigns (**Giao lại**: owner, due date, title), never changes the status. Pick a plan and give it to another pharmacist.
4. **Đặt hàng**: the tab "Gợi ý đặt hàng" suggests quantities from sales speed, stock and supplier lead time. Create draft orders in bulk. Approve `PO-DEMO-002`, created by the second manager, as the second person.
5. **Điều chuyển**: approve `TR-DEMO-001`. `TR-DEMO-002` is shipped and `TR-DEMO-003` received.
6. **Điều chỉnh tồn kho**: approve or reject the pending adjustment "Hộp bị ẩm khi kiểm kệ".
7. **Tài chính**: payments and invoices across the 60 days.

## 4. Warehouse Staff (Staff Web, `SITE-WH`)

1. **Tiếp nhận**: three goods receipts. Record a new one and fill **Giá nhập**; that cost is what gross profit uses.
2. **Tồn kho**: balances and batches with their expiry dates.
3. **Kiểm tra hàng**: batches by quality status: released, pending (`LOT-2609-005`, `LOT-WH-0019`) and rejected.
4. **Bổ sung hàng**: approve "Kho A sắp hết hàng bán chạy". The other two are already approved and rejected.
5. **Trả hàng và loại tồn**, **Kiểm kê** (one posted with a variance, one open) and **Điều chỉnh tồn kho**: create one and note that someone else must approve it.

## 5. Platform Admin (Staff Web)

1. **Người dùng**: accounts, roles and site access.
2. **Kiểm toán**: the activity log with 60 days of events; filter by action or entity.
3. **Hệ thống**: service health, metrics, queues and the search index. Admin only.
4. **Tích hợp AI**: the four AI feature cards. Set a provider here to turn the assistant and prescription reader on.
5. The admin has no Phân tích page and no revenue anywhere: sales figures are the manager's. It reads every other page and changes nothing there: no write buttons show. It has no Kế hoạch hành động, Tài chính, Đơn thuốc or Đơn hàng online page either: plans and money are the pharmacy's work, and orders and prescriptions hold customers' personal and health data. Everything else is the job of the manager, the pharmacist and the warehouse account.

## Known limits

- The history step skips a handful of sales when a product runs out in the replay; the seed output says which. The totals above stay true.
- `demo:reset` needs Docker Compose, wipes all local data, and refuses `NODE_ENV=production` and any non-local `API_BASE_URL`.
