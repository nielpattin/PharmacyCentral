# Catalog, units and pricing

- **Status:** Current
- **App and route:** staff-web, `/catalog` (products), `/units` (units of one product), `/pricing` (price records). Each is a sidebar item under **Master data**.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0016); `[observed]` a code fact read on 2026-10-26; `[standard]` a decision from industry practice. Gaps between this spec and the code are in the last table. See [README](README.md).

## Purpose

- The Pharmacy Manager maintains what the shop sells and at what price: the product record, the sale units of each product with their conversion to the base unit, and the price records per product unit. `[observed]`
- The product record drives the shop. `prescriptionRequired` decides whether a product can be sold online (ADR 0016), and the product list feeds the search index that customer-web reads (ADR 0008). `[observed]`
- A price is money. It starts as a Draft and takes effect only after a second person publishes it. `[standard]`

## Users and entry points

- Role gate: `catalog`, `units` and `pricing` are open to **Platform Admin** (read only) and **Pharmacy Manager** (`sectionRoles` in `apps/staff-web/src/permissions/section-access.ts`; [user guide](../user-guide.md#catalog-units-and-pricing)). Pharmacist and Warehouse Staff see none of these items. A direct URL falls back to the first section the user can see (`activeSection`, `App.tsx`). Platform Admin gets no create, edit, archive or publish control (BR-AUTH-010). `[observed]`
- Server gate: non-GET requests to `/api/products` (including units and images) and `/api/pricing/prices` need Pharmacy Manager; a Platform Admin write is refused `role_forbidden` (`employeeRoleRules`, `catalogWritePrefixes`, `deploy/aws/lambda/policy.mjs`). `[observed]`
- Reads: `GET /api/products` and `GET /api/products/{id}/units` are public, and so is `GET /api/pricing/active`. `GET /api/pricing/prices?status=Published` is public (`isPublishedPriceRead`). Other `GET /api/pricing/prices` reads are staff reads, and `GET /api/pricing/base-prices` needs a session only (`publicPrefixes`, `employeePrefixes`, `policy.mjs`). `[observed]`
- Scope: the catalog and its prices are chain-wide, not site data. The site rule (BR-AUTH-004) narrows site lists only, so these pages have no site selector. `[standard]`
- Entry: the sidebar; `N` (create) on each page; `/` (focus search) on Catalog and Pricing. `[observed]`

## User stories and acceptance criteria

### US1. As a Pharmacy Manager, I create and edit a product, so that the shop can sell it

- Source: `[observed]` (2026-10-26).
- Accepted when:
  - **Create product** (or **N**) opens the product drawer. Blank SKU or Name shows "Trường này là bắt buộc" under the field and sends no request.
  - A valid create sends `POST /api/products`, refreshes the list and shows "Đã tạo sản phẩm."; edit sends `PUT /api/products/{id}` and shows "Đã cập nhật sản phẩm.".
  - A duplicate SKU or barcode is refused with 409. The drawer stays open and the message is Vietnamese and names the field (gap G16).
  - Status accepts only `Active` or `Discontinued` (gap G21).
  - Closing a changed drawer asks "Bỏ các thay đổi chưa lưu?". Save writes the product first and the image second; a failed image keeps the saved product and shows the toast in Contents.
- Rules: BR-MASTER-004, BR-MASTER-004A.

### US2. As a Pharmacy Manager, I mark a product prescription-only, so that the shop does not sell it online

- Source: `[owner]` ADR 0016 (2026-10-26). The checkbox and the filter are `[observed]`.
- Accepted when:
  - The drawer checkbox and the list column read "Thuốc kê đơn" (gap G14).
  - Turning the flag on from off shows "Khách đang có sản phẩm này trong giỏ sẽ không đặt được. Tiếp tục?" before save, and save waits for the answer (gap G15).
  - The list filter offers all products, "Chỉ thuốc kê đơn" and "Không kê đơn", and sends `prescriptionRequired=true|false`.
  - After the flag is saved on, `POST /api/carts/lines` for the product answers `409 prescription_required` (ADR 0016, BR-ORD-011, BR-CART-001).

### US3. As a Pharmacy Manager, I maintain the sale units of a product, so that every quantity converts to the base unit

- Source: `[observed]`; the unit rules are `[standard]`.
- Accepted when:
  - `/units` lists the units of the chosen product with Yes/No flags. With no product chosen it shows the choose-a-product prompt and no **Add product unit** button; an empty product shows the no-units message.
  - Every product with units has exactly one base unit, with conversion factor 1, at most one default sale unit and at most one default purchase unit. Setting one of these flags clears it on the other units of that product in the same transaction (gap G5).
  - A conversion factor of zero or less is refused with "Nhập hệ số quy đổi lớn hơn 0." and is not sent (gap G16).
  - A unit name already used by the product is refused with "Tên đơn vị đã tồn tại cho sản phẩm này." (gap G16; BR-MASTER-006).
  - A unit barcode is unique across products and units (gap G6).
  - Delete asks "Xóa đơn vị sản phẩm này?". A unit that a price uses is not deleted; the message says to archive the price first (gap G22).

### US4. As a Pharmacy Manager, I create a price draft, so that it can be checked before it takes effect

- Source: `[observed]`; the validation rules are BR-PRICE-001 to 004.
- Accepted when:
  - The drawer has Product, Product unit, Unit price, Currency, Effective from, Effective to and Notes, and no site field. The Product unit list is empty until a product is chosen and clears when the product changes.
  - Currency is `VND` only, and it is the default (gap G4).
  - Effective from defaults to today in Asia/Ho_Chi_Minh (gap G13).
  - The product unit must belong to the chosen product; the server refuses otherwise (gap G19).
  - A unit price of zero or less shows "Nhập giá lớn hơn 0." (gap G16).
  - If a Published price of the same product unit overlaps the window, the drawer shows "Khoảng hiệu lực trùng với giá đã phát hành của đơn vị này." before save. The draft is still saved (gap G18).
  - A saved draft appears on `/pricing` as "Nháp" with the toast "Đã tạo bản nháp giá.". A price row is never edited after creation; a wrong draft is archived and a new one created.

### US5. As a Pharmacy Manager, I publish or archive prices, so that only the right price is in force

- Source: `[observed]`; the second-person rule and the import rule are `[standard]`.
- Accepted when:
  - Publish appears on "Nháp" rows only; Archive appears on rows that are not "Đã lưu trữ". Archive needs no second person and records the actor and time.
  - A draft cannot be published by the person who created it; the server refuses with "Người tạo bản nháp không được phát hành bản nháp đó."
  - An overlapping Published window is refused with "Hai khoảng giá đã phát hành không được chồng thời gian." (BR-PRICE-006). Two overlapping publishes cannot both succeed when they run at the same time (gap G2).
  - Publishing or archiving a price in the wrong status is refused (BR-PRICE-005, BR-PRICE-007).
  - "Phát hành đã chọn" and "Lưu trữ đã chọn" act only on eligible rows. The toast reads "Đã phát hành {succeeded} / {total} giá." and lists the rows not changed; a row that failed stays selected.
  - An import never creates a Published price and never changes a Published price (gap G3).

### US6. As a Pharmacy Manager, I find and retire products, so that the shop shows only what we sell

- Source: `[observed]`; the retire-instead-of-delete rule is `[standard]`.
- Accepted when:
  - Search matches SKU, name or barcode ("Tìm theo SKU hoặc tên"). The list pages with **Load more**, 100 rows a page.
  - A Discontinued product stays in the staff list and can be found and set back to Active (gap G8).
  - Delete succeeds only when no unit, price, stock, order line, cart line or prescription line uses the product. Otherwise it is refused with "Sản phẩm đã có đơn vị, giá, tồn kho hoặc đơn hàng. Chuyển sang \"Ngừng kinh doanh\" thay vì xóa." Deleting an unused product removes its units and prices too (gap G7).

### US7. As a Pharmacy Manager, I know what the shop shows and when

- Source: `[observed]` (ADR 0008); the message is `[standard]`.
- Accepted when:
  - After a product save the drawer shows "Trang mua hàng cập nhật sau khi chỉ mục tìm kiếm đồng bộ, có thể chậm thêm tối đa 30 giây." The staff list shows a saved change on the next load, not after the search cache expires (gap G9).
  - A shopper sees only Published prices. A product with no Published price shows "Liên hệ báo giá" and is not purchasable.
  - Draft and Archived prices are not readable by a shopper or any signed-in customer. A Discontinued product is not found by a shopper (`isActive` false).

### US8. As a Pharmacy Manager, I see who created, published and archived a product or price

- Source: `[standard]`.
- Accepted when:
  - The product drawer has a **History** tab listing create and update events with actor and time, from an entity-scoped history rather than the full audit log. Each price row shows who created, published and archived it, and when (gap G20).
  - Every catalog write is audited (`CATALOG_AUDIT_RULES`, `apps/catalog-service/src/modules/audit/audit-rules.ts`). `[observed]`

## Contents and behavior

`[observed]` unless marked `[standard]`.

**Catalog (`/catalog`).** Toolbar: search, category, prescription filter, saved views, CSV export (`products.csv`). Columns: **SKU**, **Name**, **Category**, **Manufacturer**, **Prescription required** (Yes/No), **Status**, and actions **Edit** and **Delete** (Delete asks the user to type the SKU). The product drawer has 18 fields: identity (SKU*, Barcode, Name*, Category, Manufacturer, Generic name, Active ingredient, Indications, Strength, Dosage form, Package description, Registration number); regulation and image (Prescription required, Image URL, Product image: JPEG, PNG or WebP, up to 5 MB); lifecycle (Status*, Active, Notes). Field limits come from `productInputSchema` (`apps/catalog-service/src/modules/catalog-routes.ts`). A draft of the form is kept per product, and Ctrl/⌘+S saves. `[standard]` Status is a closed list: `Active` (sold in the shop) or `Discontinued` ("Ngừng kinh doanh": not sold, kept for history). The Active checkbox and Status must agree.

**Units (`/units`).** One product at a time, chosen in the **Product** picker (kept in `?product=`). The table is not paged. The drawer has Unit name*, Barcode, Conversion factor* (to the base unit), Base unit, Default sale unit and Default purchase unit.

**Pricing (`/pricing`).** Columns: **Product**, **Product unit**, **Unit price** (with currency), **Currency**, **Effective from**, **Effective to**, **Status**, and actions **Publish** and **Archive**. Toolbar: search and status filter. The list is cursor-paged, newest effective-from first. The drawer creates drafts only.

| Status | Staff label | Visible to shoppers |
| --- | --- | --- |
| Draft | Nháp | No |
| Published | Đã phát hành | Yes, while in its effective window |
| Archived | Đã lưu trữ | No |

**Search index.** A product create, update or delete clears the catalog response cache and starts an index sweep. `[observed]` The index holds active products only and carries `prescriptionRequired`, which search-service filters on. A shopper sees a product change after the sweep and up to 30 seconds of response cache (ADR 0008). Price publish and archive do not change the index; the shop reads prices from catalog-service.

**Valuation.** Stock is valued at the Published base-unit price of today. A product with no such price is marked "Thiếu giá" and adds zero to the total (BR-FIN-002, BR-FIN-003). `[observed]`

## States

- **Loading:** skeleton rows in each table.
- **Load failure:** the error text shows above the table, and the table shows no rows and no empty-state copy (gap G17). `[standard]`
- **Empty:** "Không có sản phẩm nào khớp bộ lọc.", "Không có giá nào khớp bộ lọc.", or the no-units message. These show only after a successful load. Units show the choose-a-product prompt until a product is chosen.
- **Saving:** Save buttons are never disabled. A server refusal shows as a toast and the drawer stays open. A 401 ends the session with a visible Vietnamese notice and returns the user to sign-in afterwards. `[standard]`
- **Bulk run:** bulk buttons are disabled while a run is in progress and when no selected row is eligible.

## Out of scope

- Product import (Data import, `catalog.import`) and stock, batches and quality (Inventory and Quality).
- Purchase cost and margin: the catalog keeps no purchase cost. `[observed]`
- Store-level or customer-group prices (decision 11), editing a price row after creation, and currencies other than VND.
- Search synonyms (own page), and the customer product page and cart ([orders page spec](customer-orders-page.md)).

## Rules and designs

- Business rules: [BR-MASTER-004, 004A, 006](../business-rules.md), [BR-PRICE-001 to 008](../business-rules.md), [BR-ORD-011, BR-CART-001](../business-rules.md), [BR-AUTH-001, 002, 004](../business-rules.md), [BR-FIN-002, 003](../business-rules.md), [BR-SYN-006](../business-rules.md), [BR-RX-000A](../business-rules.md).
- Designs: [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md) (prescription-only products), [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md) (server prices), [ADR 0008](../adr/0008-search-service-in-go-on-typesense.md) (search index), [ADR 0002](../adr/0002-service-owned-databases.md) (service-owned data, so a delete check crosses services).
- [User guide, Catalog, units and pricing](../user-guide.md#catalog-units-and-pricing) and [API guide, Catalog administration](../api-guide.md#catalog-administration).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Is there a single-product create route? (API guide says no.) | Yes. `POST`, `PUT` and `DELETE /api/products` and the unit routes are current. The API guide is corrected (G12). | The code, the drawer and the audit rules all use them. `[observed]` |
| 2 | One default sale unit per product? | Yes: at most one default sale unit and one default purchase unit. Setting one clears the others. `[standard]` | The storefront and the chatbot each pick the first flagged unit (`customer-web/src/storefront/catalog.ts`; `chatbot-service/src/infrastructure/catalog-product-lookup.ts`). Two flags would show two units. |
| 3 | Exactly one base unit, with factor 1? | Yes: exactly one base unit per product, conversion factor 1. `[standard]` | Valuation reads the price of the base unit (`listBasePricesOn`). Without a factor-1 base unit the base price is wrong. |
| 4 | Is Product Status free text? | No. Status is `Active` or `Discontinued`, and must agree with the Active checkbox. `[standard]` | One lifecycle state, not two independent ones. A Discontinued product keeps its history and is not sold. |
| 5 | Should delete be allowed for used products? | Only for unused products. A used product is set to Discontinued. Deleting an unused product removes its units and prices. `[standard]` | Records of sold products must be kept; reference data in use is deactivated, not deleted. No foreign keys exist, so the server must check. |
| 6 | Should the drawer warn when the prescription flag changes? | Yes, on a change from off to on, before save. The warning names no count, because the catalog cannot see carts. `[standard]` | ADR 0016 accepts that a cart line is refused at the next order. The manager should know before saving. |
| 7 | How is a wrong price draft corrected? | A draft is never edited. It is archived (a Draft can be archived) and a new draft is created. `[standard]` | A price row records what was in force. No edit route keeps the history clean. |
| 8 | Should an overlap be flagged before publish? | Yes, as an advisory warning when the draft is created. Publish stays the authority and refuses. `[standard]` | Early notice helps the drafter. Blocking the draft would stop a replacement draft that is fixed before publish. |
| 9 | Is the 30-second shop delay acceptable with no message? | No. The drawer states the delay after a save, and the staff list shows saved values on the next load. `[standard]` | A stale staff list looks like a failed save. The shop lag is real (ADR 0008), so it must be said. |
| 10 | Why are prices per product unit? | Keep. A box and a strip have different prices and different conversions (BR-MASTER-006). Owner may change: price structure is a business choice. `[standard]` | Prices follow the unit that is sold. |
| 11 | Why are prices global, with no site? | Keep for now: one price list for every pharmacy (BR-PRICE-004). A store-level list is a new decision, not a setting. Owner may change: pricing is a business policy. `[standard]` | One price list keeps the shop consistent. |
| 12 | Why does a price start as Draft? | Keep. Publish is the approval step, taken by a second person (decision 13). Owner may change: this is an approval policy. `[standard]` | No price takes effect without another person's approval (segregation of duties). |
| 13 | Who may publish a price? | Pharmacy Manager, never the creator of the draft. Platform Admin publishes nothing (BR-AUTH-010). Archive needs no second person. Owner may change: who approves prices. `[standard]` | Segregation of duties. Archive only removes a price, and it is recorded. |
| 14 | Which currency? | VND only. The Currency field is fixed to VND. `[standard]` | BR-PRICE-002: online orders and invoices accept only VND, so a price in another currency could not be sold. |
| 15 | Which day is "today"? | Asia/Ho_Chi_Minh, for the form default, base prices and valuation. `[standard]` | The pharmacies are in Vietnam. UTC gives the previous day for seven hours each morning. |
| 16 | Can an import publish or overwrite a price? | No. Imported prices enter as Draft, and an import never changes a Published price. `[standard]` | An import would skip the review step (G3). |
| 17 | Must unit barcodes be unique? | Yes, across products and units, as product barcodes are. `[standard]` | The counter finds a product by barcode (BR-RX-000A). A shared barcode points to the wrong product. |
| 18 | Can a unit used by a price be deleted? | No. Archive the price first. `[standard]` | Keeps price records valid. |
| 19 | Who may read product and price history? | Anyone who can open the catalog page, through an entity history tab. `[standard]` | Traceability from entity history, not the full audit log. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G2 | The overlap check and the status change are one transaction. | The overlap select and the update are separate statements, so two publishes can both pass the check. | `drizzle-store-repository.ts` (`transitionPrice`) |
| G3 | Imports enter prices as Draft and never change a Published price (decision 16). BR-PRICE-004 says created prices are Draft. | The import contract defaults price status to `Published`, and the import updates an existing price row's price and status without a publisher. The code is wrong; BR-PRICE-004 stands. | `apps/catalog-service/src/contracts/imports.ts` (line 60); `apps/catalog-service/src/modules/catalog-import-service.ts` (price upsert); [Data import spec](staff-data-import.md) |
| G4 | Currency is VND only (decision 14). | Any three-letter code is accepted, and the drawer has a free-text Currency field. `business-rules.md` BR-PRICE-002 must say prices are VND only. | `catalog-routes.ts` (`priceInputSchema`); `drizzle-store-repository.ts` (`createPrice`); `apps/staff-web/src/sections/catalog/price-drawer.tsx` |
| G5 | Exactly one base unit with factor 1; at most one default sale and one default purchase unit per product (decisions 2, 3). | No check. The flags are written as sent. The user guide and API guide state no rule. | `drizzle-store-repository.ts` (`createProductUnit`, `updateProductUnit`); `apps/catalog-service/src/shared/infrastructure/schema.ts` (`product_units`) |
| G6 | A unit barcode is unique across products and units (decision 17). | `product_units.barcode` has no unique index and no check against `products.barcode`. BR-MASTER-004A covers product barcodes only. | `schema.ts` (`product_units`, `products_barcode_unique`) |
| G7 | Delete only for unused products; a used product becomes Discontinued; deleting an unused product removes its units and prices (US6, decision 5). | The delete is refused with 409 `in_use` (Vietnamese text) when a unit, price or availability row of the catalog refers to the product. Stock, order, cart and prescription lines are not checked. A used product is not set to Discontinued. The confirm says "This cannot be undone." The user guide line "A product can be deleted after confirmation" must state the rule. | `catalog-routes.ts` (`DELETE /products/:id`); `drizzle-store-repository.ts` (`deleteProduct`); `apps/staff-web/src/sections/catalog/products-page.tsx`; `docs/user-guide.md` |
| G8 | A Discontinued product is listed to staff and can be set back to Active (US6). | The staff list and the search index hold only `isActive = true`. No page shows inactive products, so they cannot be found or reactivated in staff-web. | `drizzle-store-repository.ts` (`productListFilters`); `product-search-indexer.ts` (sweep, `isActive`); `products-page.tsx` |
| G9 | The staff list shows a saved change on the next load, and the drawer states the shop delay (US7, decision 9). | The staff list reads `GET /api/products` through the search index, with a 30-second response cache in catalog-service and in search-service. No delay message. ADR 0008 accepts the lag for shoppers; the staff list needs read-after-write. The code is wrong. | `catalog-routes.ts` (`GET /products`, `searchCache`); `apps/search-service/internal/handler/handler.go` (cache); `product-drawer.tsx` |
| G12 | The API guide matches the routes. | It says "There is no single-product create route" (wrong: `POST /products` exists), and that reads under `/pricing` need no session (wrong: only `/pricing/active` is public). The code is right. | `docs/api-guide.md`, "Catalog administration" |
| G13 | "Today" is Asia/Ho_Chi_Minh in the form default, base prices and valuation (decision 15). | UTC is used: `price-drawer.tsx` (`todayIsoDate` uses `toISOString`); `catalog-routes.ts` (`/pricing/base-prices` default day); `operations-repository.ts` (valuation day). Staff-web formats dates with no `timeZone`. `docs/api-guide.md` says "default today, UTC"; `docs/business-rules.md` BR-FIN-002 says "hôm nay" with no zone. | `apps/staff-web/src/sections/catalog/price-drawer.tsx`; `catalog-routes.ts`; `apps/operations-query-service/src/modules/operations-repository.ts`; `apps/staff-web/src/staff-api.ts` (`formatDate`); `docs/api-guide.md`; `docs/business-rules.md` |
| G14 | The prescription flag is labelled "Thuốc kê đơn". "Cần đơn thuốc" is only for the disabled customer button. | `i18n/catalog.ts` maps "Prescription required" to "Cần đơn thuốc", and the drawer checkbox and the list column use it. | `apps/staff-web/src/i18n/catalog.ts`; `product-drawer.tsx`; `products-page.tsx` |
| G15 | Turning the flag on shows a warning before save (decision 6). | No warning. Save sends the flag as chosen. | `product-drawer.tsx` |
| G16 | Every message is Vietnamese and actionable (US1, US3, US4). | "Enter a price greater than zero." and "Enter a conversion factor greater than zero." have no Vietnamese text. A duplicate SKU, barcode or unit name returns the database message as `title`, because `writeError` uses `error.message` and nothing checks first. The drawer title "New product" has no translation. | `price-drawer.tsx` (`pricePositive`); `unit-drawer.tsx` (`conversionProblem`); `catalog-routes.ts` (`writeError`); `drizzle-store-repository.ts` (`createProduct`, `createProductUnit`); `product-drawer.tsx`; `i18n/catalog.ts` |
| G17 | A failed load never shows as empty (States). | On error the page shows the alert and also the empty copy ("Không có sản phẩm nào khớp bộ lọc.", "Không có giá nào khớp bộ lọc.", "This product has no units yet."). | `products-page.tsx`; `pricing-page.tsx`; `units-page.tsx` |
| G18 | A draft that overlaps a Published window is flagged before save (decision 8). | Only publish checks overlap. The drawer shows no warning. | `price-drawer.tsx`; `catalog-routes.ts` (`POST /pricing/prices`) |
| G19 | The product unit of a draft belongs to the chosen product (US4). | `createPrice` accepts any `productUnitId` and does not compare it with `productId`. | `drizzle-store-repository.ts` (`createPrice`); `catalog-routes.ts` |
| G20 | A History tab on the product drawer, and creator, publisher and archiver on each price row (US8, decision 19). | `product_prices` stores `createdBy`, `publishedBy` and `archivedBy`, but no page shows them, and the product drawer has no History tab. | `apps/staff-web/src/sections/catalog/pricing-page.tsx`; `product-drawer.tsx`; `schema.ts` (`product_prices`) |
| G21 | Status is a closed list that agrees with the Active flag (decision 4). | Status is free text up to 30 characters, independent of the Active checkbox. | `catalog-routes.ts` (`productInputSchema`); `schema.ts` (`products.status`); `product-drawer.tsx` |
| G22 | A unit used by a price is not deleted (decision 18). | `deleteProductUnit` deletes the row with no check. | `drizzle-store-repository.ts` (`deleteProductUnit`); `units-page.tsx` |
