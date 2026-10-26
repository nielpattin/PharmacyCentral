# Pharmacy Central User Guide

## Purpose

This document describes how internal teams and shoppers use the two Pharmacy Central web apps as they exist today:

- **Staff Web** (`http://localhost:5302/`) for employees: pharmacists, pharmacy managers, warehouse staff and platform administrators.
- **Customer Web** (`http://localhost:5301/`) for shoppers: product search, cart, checkout, orders, prescriptions, account and the shopping assistant.

Screens are described as the code renders them. A sidebar item lists only for roles that may open it; the labels are the ones shown on screen.

## Sign in

### Staff Web

1. Start the local system with Docker Compose (`docker compose up -d`) or start the development servers.
2. Open `http://localhost:5302/`.
3. Enter your employee email and password, then choose **Sign in**.
4. The sidebar shows only the workspaces permitted for your roles.

Customer accounts cannot sign in to Staff Web (it answers "Employee account required").

### Working with lists

Every list in Staff Web follows the same conventions.

- **Search and filters** run on the server, so a match is found however many rows exist. The search text, status filter, sort and active tab are kept in the address bar: refresh the page, press Back or share the link and you land on the same view.
- **Load more.** A list loads one page at a time, newest first. The footer reads "Showing N rows" and offers **Load more** while more rows exist.
- **Table tools.** Choose **Density** for compact, standard or loose rows and **Columns** to hide columns. Both choices are remembered per table on this device. The header stays in view while you scroll, and the actions column stays pinned on the right.
- **Export CSV** saves the rows currently loaded and the visible columns as a UTF-8 file that Excel opens correctly.
- **Bulk actions.** Where it applies (for example approving adjustments or publishing prices), tick rows. A bar shows the count and the actions. The result is one summary message, for example "3 of 4 approved", with the failures listed.
- **Saved views.** Use the **Views** menu to save the current search and filters under a name, apply them later, rename or delete them. Views are stored on this device for your account.
- **Details drawer.** Open a row to view or edit it without leaving the list. Where history is recorded (orders, prescriptions, consultations, inventory batches) the drawer has a **History** tab.
- **Confirmations.** Actions that change stock, money or approvals ask for confirmation. Irreversible ones (deleting a product, site, location or supplier, cancelling a purchase order, replacing or removing an AI key) ask you to type a code to confirm.
- **Messages.** A short toast confirms a completed action and disappears after a few seconds. Errors stay longer and say what the service refused.
- **Unsaved changes.** Leaving a form with unsaved input asks first. Long forms (product, purchase order, goods receipt, transfer, prescription) keep a draft on this device and offer **Restore draft** or **Discard** when you return. Passwords are never stored.

| Key | Action |
| --- | --- |
| `/` | Focus the search box |
| `n` | Open the create form of the page |
| `Ctrl`/`Cmd` + `S` | Save the form you are editing |
| `[` | Collapse or expand the sidebar |
| `?` | Show the shortcuts of the current page |
| `Esc` | Close the dialog or drawer |

Shortcuts other than `Ctrl`/`Cmd` + `S` and `Esc` are ignored while you type in a field.

### Customer Web

1. Open `http://localhost:5301/`.
2. Choose **Tài khoản** (Account) in the header. Signed-out visitors see the sign-in form there.
3. Sign in with **Đăng nhập**, or choose **Tạo tài khoản mới** to register with a display name, an email and a password of at least 8 characters.

Browsing, searching and the shopping assistant work without an account. Checkout, orders, prescription intake and the account pages require a signed-in customer.

### Demo credentials

The `pnpm run dev:data` command seeds one account per role (`tools/dev-import-samples.mjs` runs the identity seed in `apps/identity-service/seed.mjs`). Each account holds only the role shown. The password is the `DEMO_ACCOUNT_PASSWORD` value from `.env`.

| Role | Email | Site access |
| --- | --- | --- |
| Platform Admin | `admin@pharmacycentral.vn` | All sites (no site list needed) |
| Pharmacy Manager | `manager@pharmacycentral.vn` | `SITE-RTL` |
| Pharmacist | `pharmacist@pharmacycentral.vn` | `SITE-RTL` |
| Warehouse Staff | `warehouse@pharmacycentral.vn` | `SITE-WH` |
| Customer (Customer Web only) | `khachhang@pharmacycentral.vn` | None; customer account |

Site access uses the site codes from `data/import-samples/sites.csv`. If the sites have not been imported when the seed runs, the seed still creates the accounts, warns which sites are missing, and `dev:data` seeds again after the import. Each run resets the demo accounts' roles and site access to the table above.

Seed accounts are for local development and demonstration only.

## Roles and workspaces

Staff Web has four business roles. Access is decided by role, and non-admin users are limited to their assigned sites.

| Role | Sidebar workspaces |
| --- | --- |
| Platform Admin | Every sidebar workspace, including Governance (Users, Audit, AI integrations) |
| Pharmacy Manager | Dashboard, Pharmacist overview, Prescriptions, Online orders, Procurement, Reporting, Finance, Sites, Storage locations, Catalog, Search synonyms, Units, Pricing, Suppliers, Data import |
| Pharmacist | Pharmacist overview, Prescriptions, Online orders, Replenishment, Search synonyms |
| Warehouse Staff | Dashboard, Transfers, Replenishment, Receiving, Stocktake, Inventory, Adjustments, Returns and removals, Quality, Reporting, Data import (Stock only) |

Points to note:

- Dispensing, taking payment, refunding, and replying to consultations are pharmacist work. Platform Admins can also do them; a Pharmacy Manager sees the same prescription, counter and consultation records as a read-only view with the notice "View only: dispensing, payments and consultation replies need the Pharmacist role."
- Pharmacy Managers do not see Inventory, Transfers, Stocktake, Adjustments, Returns, Receiving or Quality in the sidebar; those belong to Warehouse Staff.
- A user who holds only the Pharmacist role lands on **Pharmacist overview** after sign-in. Dashboard is the landing page for Platform Admins, Pharmacy Managers and Warehouse Staff.
- A page's tab bar is the same for everyone who can open that page. Where a tab is marked "Dispense", "Refund" or "Confirm cash" in the sections below, the button only appears for the roles stated.

## Dashboard and Reporting

**Dashboard** (Platform Admin, Pharmacy Manager, Warehouse Staff) shows summary cards: active sites and storage locations, product and supplier counts, quantity on hand and reserved, low-stock batches, expiring batches, pending transfers, open prescriptions, open stocktakes, pending adjustments, and a list of recent activity.

**Reporting** (Platform Admin, Pharmacy Manager, Warehouse Staff) opens the Reports tab of the finance service:

1. Enter a **Report type** (the default is `sales`).
2. Choose **Run report**.
3. Review the rows: type, subject, value, occurred time and details.

Reporting does not show stock-risk summaries; low-stock and expiring batch counts are on the Dashboard.

## Master data

### Sites and storage locations

- **Sites** (Platform Admin, Pharmacy Manager) lists sites with code, name, type and address. Use **Create site** to add one.
- **Storage locations** (Platform Admin, Pharmacy Manager) lists storage locations per site. Use **Create location** to add one.

### Suppliers

**Suppliers** (Platform Admin, Pharmacy Manager) lists approved vendors. Use **Create supplier** to add one.

### Catalog, units and pricing

The catalog is split across three sidebar pages, each for Platform Admin and Pharmacy Manager.

- **Catalog** lists products (SKU, name, category, manufacturer). **Create product** and the edit action take SKU, barcode, name, category, manufacturer, generic name, active ingredient, indications, strength, dosage form, package description, registration number, prescription-required flag (`true`/`false`), image URL or uploaded image, status, notes and active flag. A product can be deleted after confirmation.
- **Units** lists the units of a selected product. **Add product unit** sets the unit name, barcode, conversion factor to the base unit, and the base, default sale and default purchase flags (`true`/`false`).
- **Pricing** lists price records with **Publish** and **Archive** actions. **Create price draft** takes the product and product unit, unit price, currency, effective-from date, optional effective-to date and notes. The form has no site field. Publishing is refused when the price window overlaps another published price.

Prices are recorded per product unit in the catalog service.

### Search synonyms

**Search synonyms** (Platform Admin, Pharmacy Manager, Pharmacist) manages groups of words that shoppers may use for the same symptom, such as "tiêu chảy" and "đi ngoài".

- Enter the **Terms** in the box, one per line or separated by commas. A group needs 2 to 20 terms, each up to 60 characters. Terms that differ only in accents or capitals count as the same term.
- Choose **Submit for review**. The group appears under **Pending review** and does not affect shopper search until another staff member approves it.
- **Approve** is disabled on a group you submitted or last edited, and its tooltip explains why. Approval by the submitter is refused by the service.
- **In use** lists approved groups that shopper searches already use.
- Each row shows its version, when it was submitted, and whether you or another staff member proposed it.
- **Edit** saves a version change and sends the group back to **Pending review**; it leaves search until someone approves the new terms.
- **Delete** removes a group from search at once; no review is needed.
- If the group changed since you opened it, the screen shows a message and reloads the list. Check the group again before approving it.

### Data import

**Data import** (Platform Admin and Pharmacy Manager; Warehouse Staff only see **Stock**, because only a Pharmacy Manager may write catalog data) has one sidebar entry per dataset, in this dependency order:

1. **Sites**
2. **Storage locations**
3. **Suppliers**
4. **Products and prices**
5. **Stock** (opening balances; needs products first)

For each dataset:

1. Choose **Download CSV template**. The template contains column headers only; it never ships sample records.
2. Fill the file with the real data from the supplier, distributor or internal system.
3. Choose the file, review the preview, then choose **Import now**.
4. Review the summary. The screen then reads the stored records back so you can confirm what the service saved.

Imports are repeatable: matching codes, SKUs and batch numbers update existing rows instead of duplicating them. Product images live in object storage, so the CSV is not the long-term store of the data.

## Purchasing and receiving

### Procurement (purchase orders)

**Procurement** (Platform Admin, Pharmacy Manager) opens on **Purchase orders**.

1. Choose **Create order** (or press **N**). A side drawer opens: enter a purchase order number, supplier, site and the order lines, then choose **Create order**. The order lines are not kept in the autosaved draft.
2. **Approve** a Draft purchase order from the list. Only Draft orders can be approved. **Cancel** is available until the order is received or cancelled.
3. Goods arriving against the order are recorded in Receiving (below). The order moves to partially received or received as quantities arrive.

### Receiving (goods receipts)

**Receiving** (Warehouse Staff) opens on **Goods receipts**.

1. Choose **Receive goods** (or press **N**). A side drawer opens with the receipt form.
2. Select the supplier, site, storage location, and receipt number. Optionally link an approved purchase order.
3. Enter each line's product, batch, expiry date and received quantity, then submit.
4. New batches await quality review before they can be used for sales.

The old tabs **Create order** and **Receive goods** are gone: a link with `?tab=Create order` or `?tab=Receive goods` opens the list.

## Quality

**Quality** (Warehouse Staff) opens the Batches list.

- **Release** approves a batch for operational use.
- **Reject** fails a batch.
- Both actions ask for review notes, which are stored with the decision.

Only released batches that have not passed their expiry date count as sellable. Shopper availability and reservations use those batches only, and an hourly sweep updates availability for batches that expire while nothing else changes.

## Inventory operations

**Inventory** (Warehouse Staff) is a tabbed workspace. The sidebar items **Inventory**, **Adjustments**, **Transfers**, **Stocktake**, **Returns and removals** and **Replenishment** each open it on the matching tab. Two rows pick the view: the group (**Stock**, **Supply**, **Control**), then a tab inside it. A row with a single choice is hidden, so a role that reads only some tabs sees fewer.

| Group | Tab | What it does |
| --- | --- | --- |
| Stock | Balances | Quantity on hand and reserved per product batch, with expiry dates |
| Stock | Batches | Product batches and their quality status. **Create batch** opens a drawer (product, supplier, batch number, manufactured and expiry dates, manufacturer, quality notes). **Release** and **Reject** show only for the verdict a batch does not already have |
| Stock | Movements | Stock movement ledger, and **Record stock movement** |
| Supply | Transfers | Transfer orders between sites and storage locations; **Create transfer** opens a drawer |
| Supply | Replenishment | Replenishment requests with Approve, Reject, Fulfill and Cancel |
| Supply | Returns | Returns and removals with reasons: Return to supplier, Damaged stock, Expired stock, Inventory removal |
| Control | Adjustments | **Submit stock adjustment**; pending adjustments can be approved or rejected |
| Control | Stocktake | Stocktake sessions, **Create stocktake**, **Record count** for counted quantities (a drawer), and **Post adjustments** for pending sessions |

The old tabs **Create batch**, **Create transfer** and **Count line** are gone: a link with `?tab=Create batch` (or the other two) opens **Balances**. Press **N** on a list to open its create drawer.

**Transfers** workflow: create a transfer with its lines; approve it (`PendingApproval` to `Approved`); ship it (`InTransit`); receive it at the destination. A pending or approved transfer can be cancelled.

**Replenishment** workflow: a pharmacist or warehouse user creates a request; warehouse staff approve or reject it, then fulfill it or cancel it.

**Stocktake** workflow: create a session for a site and location; record counted quantities per line; post adjustments for the session.

**Adjustments** workflow: submit an adjustment with its type, quantity and reason; a reviewer approves or rejects it with optional approval notes.

Pharmacists do not have Inventory in the sidebar and cannot adjust balances.

## Online orders

**Online orders** (Pharmacist, Pharmacy Manager) lists shopper orders with status tabs: All, Pending, Confirmed, Preparing, Ready, Delivering, Completed and Cancelled. Each row shows the order number, store, fulfillment (Pickup or Delivery), status, payment status, total and placed time. The screen is view-only.

## Prescriptions and counter

**Prescriptions** (Pharmacist, Pharmacy Manager) is titled **Prescriptions and counter sales**. The sidebar item **Pharmacist overview** opens the same page on the **Counter transactions** tab.

Tabs:

| Tab | Who | What it does |
| --- | --- | --- |
| Prescriptions | Both | Prescriptions with patient, status, site and created time. **View** opens the details. Pharmacists also get **Dispense** on each row, and **Create invoice** and **Cancel prescription** in the **More actions** menu (or in the details drawer) | and phone, optional customer account (found by exact phone or email), site and storage location, doctor name and license, lines (product, unit, quantity, dosage, frequency, duration, notes), and notes. Submitting requests the stock reservation |
| Counter transactions | Both (actions for Pharmacist, Platform Admin) | Invoices and counter transactions with payment status and amount. **Create invoice**, **Confirm cash** (pending payments) and **Refund** (paid payments) |
| Consultations | Both (replies for Pharmacist, Platform Admin) | Shopper requests from the intake page, filtered Open or Answered, showing the prescription, its lines and any shopper note. Pharmacists type a reply and choose **Send reply** |

Two actions open as side drawers over the Prescriptions tab, so the queue stays in view:

- **Create prescription** (header button or **N**; Pharmacist, Platform Admin): patient name and phone, optional customer account (found by exact phone or email), site and storage location, doctor name and license, lines (product, unit, quantity, dosage, frequency, duration, notes), and notes. Submitting requests the stock reservation.
- **Dispense** (row button; Pharmacist, Platform Admin): for each line pick the product batch and dispensed quantity, then choose **Dispense**. The drawer address keeps `?prescription=<id>`, so a refresh reopens it.

The old tabs **Create** and **Dispense** are gone: a link with `?tab=Create` or `?tab=Dispense` opens **Prescriptions**.

Counter flow for a pharmacist:

1. Choose **Create prescription** for the patient, linking a customer account if the patient has one. This reserves stock.
2. Choose **Dispense** on the prescription row, and for each line select the batch and quantity handed over. Dispense records the movement; the service refuses a batch that cannot supply the quantity.
3. In **Counter transactions**, create the invoice and confirm cash when the customer pays. Refund a paid invoice with a reason if the sale is reversed.
4. Cancel a prescription from its row if the customer declines.

## Finance

**Finance** (Platform Admin, Pharmacy Manager) has three tabs.

- **Summary**: paid, refunded and net amounts; inventory value and reserved value; the count of products missing a published price (**Missing prices**); receipt, dispensed and return quantities; an inventory activity table; and an inventory valuation table with each batch's price status. Stock is valued at the current published price per base unit, so a stocked product without a published price adds nothing to the value.
- **Invoices**: payment invoices with payment code, prescription or order, status, amount and created time. Pharmacists and Platform Admins can **Confirm cash** on pending invoices and **Refund** paid ones; Pharmacy Managers read the list only.
- **Reports**: the reporting tab described under Dashboard and Reporting.

External accounting ledger posting is outside the scope of these screens.

## Audit log

**Audit** (Platform Admin) is the Audit tab of **Governance**. It records who changed what: every write a person makes in Sales (orders, prescriptions, consultations), Catalog (products, units, prices, sites, storage locations, suppliers, search synonyms, AI credentials), Inventory (batches, quality decisions, adjustments, movements, transfers, stocktakes, returns, replenishment), Procurement (purchase orders, goods receipts) and Identity (staff sign-in and sign-out, password and profile changes, and an administrator creating a user, changing access, resetting a password or revoking sessions).

Filter by entity type (grouped by area), actor and date range, or search by action, entity ID or actor ID. Each record shows the action in words (for example "Duyệt điều chuyển"), the entity, the actor, the site, the time and the details. The actor column reads "System" for changes nobody made by hand, such as an online order that expired unpaid.

The log keeps no passwords, API keys or free-text notes. Details hold only a few safe fields, such as the roles given to a user or the decision on a batch. Shopper activity is not audited, and neither is a failed sign-in. Entries appear a few seconds after the change, because they travel through RabbitMQ; a change made while the broker is down is recorded when it is back.

## Users and access

**Users** (Platform Admin) is the Users tab of **Governance**, next to **Audit**. It lists employee accounts only (customers sign up on the shop site and are not listed) with name, email and roles. Search by name or email, and keep a search as a saved view.

Per row:

- **Edit access** opens a drawer with the account's roles and site access as checkboxes. Choose at least one role, then **Save access**.
- The **More actions** menu (three dots) holds **Reset password** (a new password of at least 12 characters) and **Revoke sessions** (signs the account out everywhere, for example after a security incident; asks to confirm).

**Create user** (or press `n`) opens the drawer "Create employee account": email, display name, password, roles and site access, then choose **Create employee**. Leaving a drawer with unsaved input asks first; Ctrl+S saves.

## AI integrations

**AI integrations** (Platform Admin) has four cards, one per AI feature:

| Feature | What it does | Without a key |
| --- | --- | --- |
| Shopping assistant | Answers shopper questions on Customer Web | The assistant cannot answer |
| Prescription photo reading | Reads medicines from a photo of a printed prescription | Photo reading is off; QR intake still works |
| Semantic product search | Finds products by meaning, not only the words typed. Searches of fewer than three words always match keywords only | Search matches keywords only |
| Question screening | Checks each shopper question first; greetings, off-topic questions, emergencies and prompt-injection attempts get a fixed reply | Every question goes straight to the assistant |

Each card shows a source badge: **Saved key**, **Environment key**, or **Not configured**. For a saved key it also shows the provider, model, base URL, the last four characters of the key, and when and by whom it was updated. Otherwise it explains that the value comes from the server environment.

- Set **Provider**, **Model**, **Base URL** and **API key**, then choose **Save settings**. The base URL must start with `https://`. The key is encrypted and never shown again.
- Leave **API key** empty to keep the saved key when the provider has not changed.
- **Remove key** deletes the saved settings. If the server environment has settings, the feature falls back to them; otherwise the feature stops working as described above.
- Saving or removing a key starts a background reindex, so semantic search results update shortly afterwards.

When the shopping assistant cannot answer, shoppers see "Trợ lý tư vấn đang gặp sự cố. Vui lòng thử lại sau ít phút." in the chat widget.

## Customer Web

### Browsing and search

- **Home** (`/`): a search box ("Tìm kiếm sản phẩm, tên thuốc, mã SKU..."), product categories in the header, and sorting by default, price (low to high or high to low) or name.
- **Category** (`/danh-muc/...`): products in one category.
- **Product** (`/san-pham/...`): name, manufacturer, badges for prescription-required products and stock status ("Còn hàng" or "Hết hàng"), and **Thêm vào giỏ hàng**.
- **Pharmacies** (the store finder on Home, `/#nha-thuoc`): choose a pharmacy to see its stock and collect orders there; **Tìm nhà thuốc gần bạn** uses your location.

Stock shown for a product is for the selected pharmacy only.

### Cart and checkout

**Đặt hàng & thanh toán** (`/don-hang`) requires a signed-in customer.

1. Review the cart. Products without a price cannot be checked out; remove them or use **Nhờ dược sĩ tư vấn** from the intake results.
2. Choose the fulfillment: **Giao tận nơi** (delivery, with the fee calculated from the pharmacy to your delivery point) or **Nhận tại nhà thuốc** (pickup at the selected pharmacy).
3. Choose the payment: **Chuyển khoản SePay QR** (scan the VietQR code with your banking app; the order is confirmed automatically) or **Thanh toán khi nhận hàng** (cash on delivery).
4. Choose **Đặt hàng**.

After an order is placed, the payment panel shows the order number, payment code, amount and status, and the SePay QR code and transfer description when QR payment is chosen. It reads "Đã nhận thanh toán" once payment is received.

### Orders

**Đơn hàng của tôi** (`/don-hang-cua-toi`) lists the signed-in customer's orders. The order the customer most likely came for sits at the top as a large block: the newest order whose medicine is ready or on its way, otherwise the newest order still being handled, otherwise the newest one. It shows the package photo, the status as a sentence (for example "Thuốc của bạn đã sẵn sàng để nhận"), a five-step progress bar with labels (Chờ xác nhận, Đã xác nhận, Đang lấy thuốc, Sẵn sàng nhận hàng or Đang giao hàng, Hoàn tất), the pharmacy to collect from, the total and **Xem chi tiết đơn**, which opens every medicine with quantity and price, subtotal, delivery fee, the pharmacy address and the payment status. **Các đơn khác** lists the rest, newest first, each with its photo, status, date, total and a **Chi tiết** button; the tabs Tất cả, Đang xử lý, Hoàn tất and Đã huỷ filter that list. A cancelled order shows no payment note. The page refreshes itself every 10 seconds.

### Account

**Tài khoản** (`/tai-khoan`) requires sign-in and has six sections:

- **Tổng quan**: greeting, number of saved addresses, prescriptions on the account, and recent orders.
- **Đơn hàng**: order list, linking to the full orders page.
- **Đơn thuốc**: consultation requests and prescriptions the pharmacy has recorded to the account.
- **Địa chỉ giao hàng**: add, edit, delete and set the default delivery address (with a map picker).
- **Thông tin cá nhân**: display name and contact details.
- **Đổi mật khẩu**: change the password; you sign in again afterwards.

**Đăng xuất** signs out and clears the cached account data.

### Prescription intake

**Gửi đơn thuốc** (`/gui-don-thuoc`) requires sign-in.

1. Upload a clear photo of the printed prescription.
2. If the page has a QR code, it is read on your device first. Without a readable QR code the photo is sent to the AI provider configured by Platform Admin, which reads the medicine list only; the page states that Pharmacy Central does not keep the photo.
3. Review the results: each line is matched to catalog products, with badges for prescription-only and availability.
4. For lines with no suitable product at the selected pharmacy, choose **Nhờ dược sĩ tìm giúp**, add an optional note, and send. A pharmacist replies in Staff Web under **Consultations**, and the answer appears in your account under **Đơn thuốc**.

Prescription-only products show "Liên hệ báo giá" in the assistant and cannot be added to the cart without a price.

### Shopping assistant

The **Trợ lý tư vấn** button floats on every Customer Web page and keeps its conversation as you navigate. Ask about products or how to send a prescription. Product answers show product cards with the prescription-only badge and price or "Liên hệ báo giá".

- **Cuộc trò chuyện mới** starts a new conversation.
- If the assistant is unavailable, you see "Trợ lý tư vấn đang gặp sự cố. Vui lòng thử lại sau ít phút."
- If you ask too fast, you see a request to wait a moment; if the conversation is too long, you are asked to start a new one.

## Demo walkthrough

Use the demo accounts above, with `pnpm run dev:data` already run.

1. **Platform Admin**: sign in to Staff Web. Open **Users** to review accounts and access, **Audit** for the activity log, and **AI integrations** for the four AI feature cards.
2. **Platform Admin or Pharmacy Manager**: open **Sites**, **Storage locations**, **Suppliers** and **Catalog**, then **Units** and **Pricing** to see sale units and price drafts.
3. **Pharmacy Manager**: open **Procurement**, create a purchase order and approve it.
4. **Warehouse Staff**: open **Receiving**, record the goods receipt against that order, then open **Quality** and release the new batch.
5. **Warehouse Staff**: open **Inventory** to see balances and movements; open **Transfers** to create and ship a transfer; open **Returns and removals** and **Stocktake**; open **Adjustments** to submit and approve an adjustment.
6. **Pharmacist**: sign in, open **Pharmacist overview**, then **Prescriptions**, choose **Create prescription**, then **Dispense** on its row. In **Counter transactions**, create the invoice and confirm cash.
7. **Pharmacy Manager**: open **Finance** and **Reporting** to review the summary, invoices and report rows.
8. **Pharmacist**: open **Search synonyms**, submit a group, then sign in as another staff member to approve it.
9. **Customer**: open Customer Web at `http://localhost:5301/`, search for a product, add it to the cart, sign in, and check out with pickup or delivery. Open **Đơn hàng của tôi** to track it, and try **Gửi đơn thuốc** and the shopping assistant.

## Demonstration guidelines

- Use local development data only.
- Do not enter real patient, supplier, or employee personal information.
- Do not reuse development credentials in production environments.
- Where a change needs another staff member's approval (search synonyms), sign in with a second employee account to approve it.

## Operational best practices

- Assign individual named accounts to staff rather than shared accounts.
- Restrict site access to the specific locations where staff members work.
- Review quality decisions, stock adjustments and the audit log regularly.
- Keep development seed credentials restricted to development environments.
