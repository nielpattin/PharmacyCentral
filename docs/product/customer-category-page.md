# Category page and category menu

- **Status:** Current
- **App and route:** customer-web, `/danh-muc/$slug` (a group or a sub-category slug). The grouped menu is in the site header on every storefront page.
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0016, 2026-10-26); `[observed]` a fact read from the code on 2026-10-26; `[standard]` a decision from industry practice. Differences between this spec and the code are listed in [Gaps](#gaps-against-the-code-2026-10-26). See [README](README.md).

## Purpose

- `[observed]` The category page lists the products of one shelf group (for example **Thuốc**) or one sub-category (for example **Dị ứng**), so a shopper can browse without search.
- `[standard]` Shoppers look for a shelf the way they walk a pharmacy counter. The menu therefore groups the catalog's category values into six shelf groups, not raw category names. Group membership is fixed in code (Decisions 1 and 8).
- `[standard]` Stock on the page refers to one pharmacy, the shopper's, so that the shopper never sees stock they cannot collect or receive there.

## Users and entry points

- `[observed]` Any shopper. Browsing and adding to the cart need no sign-in. A signed-out shopper's cart is kept in the browser (BR-CART-005, [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md)), and the header cart count reads that cart.
- `[observed]` Entry points: the **Danh mục sản phẩm** bar in the header (every storefront page); the breadcrumb on a product page (`/san-pham/$productId`), which links to its group page; the footer **Danh mục** list (target: the same groups, Decision 2); a direct URL.
- `[observed]` `/danh-muc/$slug` is the only category route. `/danh-muc` with no slug has no route.

## User stories and acceptance criteria

### US1. As a shopper, I open a shelf group from the header menu, so that I see the products on that shelf

- Source: `[observed]` 2026-10-26 for the bar; the presence rule `[standard]`.
- Accepted when:
  - The bar shows one item per group, in this order: **Thuốc**, **Thực phẩm chức năng**, **Dược mỹ phẩm**, **Chăm sóc cá nhân**, **Thiết bị y tế**, **Chăm sóc tại nhà**, then **Hệ thống nhà thuốc**.
  - A group is shown when at least one of its member values has an active product, judged by `GET /api/products/count?category=<value>` for each member (gap G1). A group with no such member is not shown.
  - While the menu loads, the bar reads "Đang tải danh mục…". If the menu fails, the bar reads "Không tải được danh mục." with a **Tải lại** button (gap G4).
  - Clicking a group opens `/danh-muc/<group slug>`. The heading is the group label; the count line reads "N sản phẩm" once loaded.
  - At 1024px and wider, hovering or focusing a group with sub-categories shows them and a **Xem tất cả** link to the group page. Below that width the dropdown is hidden and the sub-categories are reached through the tiles (US2). `[observed]`
  - The footer **Danh mục** list shows the same groups and sub-categories and links to `/danh-muc/<slug>` (gap G18).

### US2. As a shopper, I open a sub-category, so that I see only that category's products

- Source: `[observed]` 2026-10-26.
- Accepted when:
  - A group page lists its sub-categories as tiles, each linking to its page. A sub-category exists for each member whose label differs from the group label (table in Contents).
  - `/danh-muc/di-ung` shows the heading **Dị ứng**, the breadcrumb **Trang chủ › Thuốc › Dị ứng**, and only products whose category is `Allergy relief`.
  - The **Thuốc** group page shows the products of all six members of the group and no tile for **Thuốc** itself.
  - A label change changes the slug, and the old URL then shows the not-found block (Decision 8).

### US3. As a shopper, I see a clear message when a category does not exist, is empty, or failed to load

- Source: `[observed]` 2026-10-26; the error rule `[standard]`.
- Accepted when:
  - A slug that is not a configured group or sub-category shows **Không tìm thấy danh mục này**, the text "Danh mục có thể đã được đổi tên. Chọn danh mục khác trong thanh menu phía trên.", and a **Về trang chủ** link to `/`.
  - A known category with no active product shows **Chưa có sản phẩm trong &lt;label&gt;** and "Danh mục này đang được cập nhật. Chọn danh mục khác trong thanh menu phía trên." A group page still shows its sub-category tiles.
  - A failed menu or product request shows the error with **Tải lại**. It never shows the not-found block or the empty block (gap G5).
  - Every error text is Vietnamese. The page never shows a server `title` or `detail` as is (gap G6).

### US4. As a shopper, I sort the products, so that I can find a cheaper or a named product

- Source: `[observed]` 2026-10-26; the URL and reset rules `[standard]`.
- Accepted when:
  - The **Sắp xếp** select (aria-label **Sắp xếp sản phẩm**) offers **Mặc định**, **Giá thấp đến cao**, **Giá cao đến thấp**, **Tên A - Z**.
  - **Mặc định** keeps the server's order. For a browse without a search term, catalog-service and search-service both order by SKU ascending. `[observed]`
  - Price sorts use the price of the default sale unit in effect today in Asia/Ho_Chi_Minh (gap G10). Products with no price go after priced ones. **Tên A - Z** uses Vietnamese collation.
  - The sort is in the URL as `sap-xep` (`price-asc`, `price-desc`, `name`), as on Home. **Mặc định** omits it. A reload or a shared link keeps the sort (gap G19).
  - A link to another category carries no sort, so that category opens at **Mặc định**.

### US5. As a shopper, I add a product from a category card, so that it goes to my cart

- Source: `[observed]` 2026-10-26, with the prescription rule `[owner]` (ADR 0016, 2026-10-26).
- Accepted when:
  - The card's name and photo link to `/san-pham/<id>`.
  - **Chọn mua** adds one unit of the default sale unit through the shared add-to-cart hook and shows the cart feedback. The line is added unticked (BR-CART-001). `[observed]`
  - A product with `prescriptionRequired = true` shows a disabled **Cần đơn thuốc** button and sends no add-to-cart request, signed in or not (BR-ORD-011, [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md)). The button's accessible description states the reason, "Thuốc kê đơn không đặt online. Hãy gửi đơn thuốc hoặc nhờ dược sĩ tư vấn." (gap G17)
  - A product with no price shows "Liên hệ báo giá" and a disabled **Chọn mua** button (gap G16).
  - A product sold out at the shopper's pharmacy shows a **Hết hàng** badge and a disabled **Hết hàng** button (gap G15).
  - A product whose published price did not load shows "Chưa tải được giá" and keeps **Chọn mua** enabled (gap G11).
  - A product whose price is beyond the first 500 published prices shows its real price (gap G9).

### US6. As a shopper, I see stock for the pharmacy I chose, so that the stock I see is one I can collect or receive

- Source: `[standard]`; the [user guide](../user-guide.md#browsing-and-search) already states it.
- Accepted when:
  - Under the heading the page reads "Tồn kho theo nhà thuốc: &lt;name&gt;" with a **Đổi nhà thuốc** link to `/#nha-thuoc` (gap G12).
  - The pharmacy is the one the shopper picked, and the choice is remembered across pages, as on Home (gap G13). Until the shopper picks one, the first customer-facing pharmacy is used, as on Home (BR-MASTER-002).
  - A product with no availability row at that pharmacy shows **Hết hàng**. If the availability request fails, the card shows "Chưa rõ tồn kho" and **Chọn mua** stays enabled, because the server checks stock at order (ADR 0004) (gap G14).
  - With no customer-facing pharmacy, the stock line reads "Chưa có nhà thuốc đang hoạt động" and cards show "Chưa rõ tồn kho".

### US7. As a shopper, I see every product in a long category, so that no product is hidden by a cap

- Source: `[standard]`.
- Accepted when:
  - The count line shows the total from the count endpoint. If the count fails, the line shows the error, never "0 sản phẩm" (gap G7).
  - **Xem thêm** loads the next 100 products of each member that has more, following `X-Next-Cursor`, and shows how many remain (gap G7).
  - A group page lists the products of all its members in one list in SKU order, not member by member (gap G8).

## Contents and behavior

**Menu groups.** `[observed]` The table is the current membership, which lives in code as `NAV_GROUPS` (`apps/customer-web/src/storefront/navigation.ts`). `[owner]` It stays in code; a change to membership is a code change (Decision 8). Labels come from `categoryLabel` (`storefront/catalog.ts`). A sub-category page exists only where the member label differs from the group label.

| Group | Member values (label) | Sub-category pages |
| --- | --- | --- |
| Thuốc | Medicine (Thuốc), Allergy relief (Dị ứng), Cardiovascular care (Tim mạch), Diabetes care (Tiểu đường), Digestive health (Tiêu hóa), Respiratory care (Hô hấp) | Dị ứng, Tim mạch, Tiểu đường, Tiêu hóa, Hô hấp |
| Thực phẩm chức năng | Supplement (Thực phẩm chức năng), Vitamin and supplement (Vitamin và thực phẩm bổ sung) | Vitamin và thực phẩm bổ sung |
| Dược mỹ phẩm | Cosmetic (Dược mỹ phẩm) | none |
| Chăm sóc cá nhân | Personal care (Chăm sóc cá nhân), Family planning (Kế hoạch hóa gia đình) | Kế hoạch hóa gia đình |
| Thiết bị y tế | Medical device (Thiết bị y tế), Medical supply (Vật tư y tế), Wound care (Chăm sóc vết thương) | Vật tư y tế, Chăm sóc vết thương |
| Chăm sóc tại nhà | Home care (Chăm sóc tại nhà) | none |

**Slugs.** `[observed]` Each group and sub-category slug is the ASCII, lowercase, hyphenated form of its label (`categorySlug`). `[owner]` Changing a group label or a category label changes its slug, so an old URL then shows the not-found block (Decision 10, accepted). Examples: **Thuốc** → `thuoc`, **Dị ứng** → `di-ung`, **Vitamin và thực phẩm bổ sung** → `vitamin-va-thuc-pham-bo-sung`.

**Category page, in order.**

1. Breadcrumb: **Trang chủ**, then the parent group for a sub-category, then the current label.
2. Heading (the label); count line "N sản phẩm" (the total); stock line (US6); **Sắp xếp** select on the right.
3. Error alert with **Tải lại**, when a request failed.
4. Sub-category tiles, on group pages only.
5. Product grid: 2 columns on small screens, up to 5 on extra-wide ones. Each card shows the photo, name, manufacturer ("Đang cập nhật nhà sản xuất" when missing), active ingredient and strength when present, category label and unit name, the price per unit or "Liên hệ báo giá", and **Chọn mua**. Badges: **Hết hàng** only. The card has no "Thuốc kê đơn" badge (Decision 3).
6. **Xem thêm** when more products exist (US7).
7. Footer, the same on every storefront page.

**Prescription-only products.** `[owner]` ADR 0016: the card shows the disabled **Cần đơn thuốc** button. The product page carries the notice and the **Gửi đơn thuốc** link, and the "Thuốc kê đơn" badge appears on the product page and on chat cards.

**Data.** The page reads: `GET /api/products/count?category=<value>` per member (menu and count line); `GET /api/products?category=<value>&limit=100` per member, following `X-Next-Cursor`; `GET /api/pricing/prices?status=Published&limit=500`, following `X-Next-Cursor`; `GET /api/availability?siteId=<pharmacy>`. The API contract is in [api-guide](../api-guide.md). Prices and stock shown are previews; the server recalculates prices and fees at checkout (ADR 0004). Prices are system-wide per product unit, not per pharmacy ([business rules, section 6](../business-rules.md)).

## States

- **Menu loading:** the bar and the page body read "Đang tải danh mục…".
- **Menu failed:** the bar reads "Không tải được danh mục." with **Tải lại**; the page body shows the error with **Tải lại**, not the not-found block.
- **Unknown slug:** the not-found block (US3).
- **Products loading:** card skeleton grid; the count line reads "Đang tải sản phẩm".
- **Products failed:** an error alert, and in the grid area "Không hiển thị được sản phẩm. Vui lòng kiểm tra kết nối mạng và tải lại trang." with **Tải lại**.
- **Count failed:** the count line shows the error text, not a number.
- **Empty category:** the empty block (US3).
- **Prices loading:** a placeholder bar in the price line. **Prices failed:** "Chưa tải được giá" on each affected card, and an error alert with **Tải lại** (Decision 12).
- **Availability failed or no pharmacy:** "Chưa rõ tồn kho" on the cards (US6).
- **Signed out:** the full page works; **Chọn mua** writes to the browser cart.

## Out of scope

- A search box or filters inside a category. The header search opens Home with `?q=`.
- Sorting across products not yet loaded. The API has no sort parameter, so price and name sorts order the loaded products, and "Xem thêm" keeps the sort.
- **Mua ngay** on the card. It exists only on the product page.
- Per-pharmacy prices. Prices are system-wide (business rules, section 6).
- Numbered pagination. The storefront uses "Xem thêm".
- Editing groups from any storefront or staff surface. Groups are fixed in code (Decision 8).

## Rules and designs

- BR-CART-001 (unticked new line), BR-CART-005 (signed-out cart in the browser), BR-ORD-001 (a product with no price cannot be ordered), BR-ORD-011 (prescription-only products are not sold online), BR-PRICE-008 (price in effect on a date), BR-MASTER-002 (customer-facing pharmacies). No `BR-*` covers menu grouping (Decision 13).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices, stock and fees are the server's.
- [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md) and [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md).
- [User guide, Browsing and search](../user-guide.md#browsing-and-search).
- [Home](customer-home-page.md) (pharmacy choice and sort), [Product](customer-product-page.md) (prescription notice, stock message), [Orders](customer-orders-page.md) (where a card's product ends up), [Staff catalog](staff-catalog-units-and-pricing.md) (category values and prices).

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Who chose the six groups, and should they follow a published standard? | **[standard]** Keep the six groups as the shop's shelf structure (table in Contents). The menu follows how shoppers look for a shelf, not a trade classification. Membership is fixed in code (Decision 8). | Shoppers look for a shelf, not a classification code. Owner may change. |
| 2 | The footer **Danh mục** links to Home. Which surface is the category page? | **[standard]** The header groups are the category pages. The footer lists the same groups and sub-categories and links to their pages (gap G18). Home's `?danh-muc=` stays a Home filter. | One category navigation on every page; a raw value on Home is not a shelf. |
| 3 | Should a card show a "Thuốc kê đơn" badge, or is the disabled button enough? | **[standard]** No badge on cards. The disabled **Cần đơn thuốc** button, with its reason, is the signal. "Thuốc kê đơn" is used on the product page and on chat cards (ADR 0016). | One signal per card; the disabled button already says what the shopper cannot do. |
| 4 | Is an all-pharmacy stock badge intended? | **[standard]** No. Stock is for the shopper's pharmacy, and the page names that pharmacy (US6). | Stock at another pharmacy promises goods the shopper cannot collect or receive. |
| 5 | Should a sold-out card block the shopper before the cart? | **[standard]** Yes. The button is disabled and reads **Hết hàng**. The product page offers a pharmacist request (`/gui-don-thuoc`). The server still checks stock at order (ADR 0004). | Common e-commerce practice (Baymard Institute research on out-of-stock handling): give a way forward, not a dead end. |
| 6 | Should a taxonomy error show "not found", and is there a retry? | **[standard]** No. A failed request shows the error and **Tải lại**. "Không tìm thấy danh mục này" only for a slug that is not configured. | A load error is not an empty or missing category. |
| 7 | Only the first 100 products decide the menu. Which ordering is the API default, and should the menu use a count or the full list? | **[standard]** The default is SKU ascending, which catalog-service and search-service both use for a browse without a search term. The menu asks `GET /api/products/count?category=<value>` for each member, which counts the whole active catalog. | A count is exact and cheap. Reading the whole catalog only to learn which categories exist is wasteful. |
| 8 | Who maintains the groups, and should groups be managed in code or in data? | **[owner]** 2026-10-26: groups are fixed in code (`NAV_GROUPS`). Changing a group label or a category label changes its slug, so an old URL shows **Không tìm thấy danh mục này**. This is documented and accepted. A category value in no group is not in the menu, but stays searchable and listed on Home. | The owner decided against managing groups in data. The slug cost is accepted, and the group set changes rarely. |
| 9 | Is a cap of 100 per category acceptable, or is paging required? | **[standard]** Paging. **Xem thêm** loads the next 100 of each member, and the count line shows the total. | A silent cap hides products. The storefront lists page or load more. |
| 10 | Should slugs be stable identifiers instead of following the label? | **[owner]** 2026-10-26: no. A slug follows its label (Decision 8). Old URLs after a rename show the not-found block, as documented. | URLs are bookmarked and shared, so the trade-off is recorded. The owner accepts it. |
| 11 | Should the sort reset when the shopper moves to another category? | **[standard]** Yes. The sort is in the URL (`sap-xep`, as on Home). Category links carry no sort, so a new category opens at **Mặc định**. Paging within a category keeps the sort. | The URL describes the view; a link starts clean; Back and reload keep the shopper's choice. |
| 12 | What does the card show when prices fail to load? | **[standard]** "Chưa tải được giá", an error alert with **Tải lại**, and **Chọn mua** stays enabled. The server prices the order (BR-ORD-001), and the cart shows the price before checkout. | An unknown price is not "no price". Blocking purchase on an unknown price hides stock that can be sold. |
| 13 | Does the category menu need a business rule? | **[standard]** No new `BR-*`. Purchase rules are BR-CART-001, BR-CART-005, BR-ORD-001 and BR-ORD-011. Menu presentation is this spec. | Grouping changes neither prices, stock nor orders. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | A group is shown when a member has an active product, judged by the count endpoint per member | Menu built from `listProducts({ limit: 100 })` only; `X-Next-Cursor` is never read, so a category outside the first page is missing | `apps/customer-web/src/storefront/navigation.ts` `buildCategoryPages`; `SiteHeader.tsx`; `CategoryPage.tsx`; `customer-api.ts` `listProducts` (no count call) |
| G4 | The bar reads "Đang tải danh mục…" while loading and "Không tải được danh mục." with **Tải lại** on failure | The bar renders only when `pages.length > 0`, so it is absent while loading and after an error | `SiteHeader.tsx` (`pages.length > 0`) |
| G5 | A failed request shows the error with **Tải lại**, never the not-found block | The not-found block shows whenever the taxonomy query is not pending and has no page, including after an error | `CategoryPage.tsx` (`!page` branch) |
| G6 | Every error text is Vietnamese; no raw server `title` or `detail` | `request` uses `problem.detail ?? problem.title` as the message, and the page shows `queryError.message` as the alert | `customer-api.ts` `request`; `CategoryPage.tsx` (`error`) |
| G7 | Each member pages 100 at a time with **Xem thêm**; the count line shows the total from the count endpoint; a count error is shown as an error | One request per member with `limit=100` and no next page; the count line shows the number loaded | `CategoryPage.tsx` `productsQuery`, count line |
| G8 | Group page lists all members in one list in SKU order | Members are fetched in parallel and concatenated in member order | `CategoryPage.tsx` `productsQuery` (`Promise.all`, `flat`) |
| G9 | All published prices are read, following `X-Next-Cursor` | One request with `limit=500`; a product past row 500 shows "Liên hệ để báo giá" | `customer-api.ts` `listPublishedPrices`; `CategoryPage.tsx` |
| G10 | The price in effect is judged on the Asia/Ho_Chi_Minh date (BR-PRICE-008; storefront date rule) | `new Date().toISOString().slice(0, 10)` gives the UTC date, so from 00:00 to 07:00 in Vietnam a price starting today is not applied | `CategoryPage.tsx` `priceIndex` |
| G11 | A failed price request shows "Chưa tải được giá", an alert with **Tải lại**, and keeps **Chọn mua** enabled | Every card shows "Liên hệ để báo giá"; the page shows the raw message of the first failed query | `ProductCard.tsx` price line; `CategoryPage.tsx` `queryError` |
| G12 | Stock is for the shopper's pharmacy, and the heading names it (user guide: "Stock shown for a product is for the selected pharmacy only") | `listAvailability()` is called with no pharmacy, so any site with stock marks the product in stock; no pharmacy is named | `CategoryPage.tsx` `availabilityQuery`; `catalog.ts` `buildStockIndex` |
| G13 | The shopper's pharmacy choice is remembered across pages | No stored choice. Home falls back to the first store and keeps it in the URL; the order page keeps it in component state; the category page has none | `HomePage.tsx` `readFilters`; `OrdersHubPage.tsx` `selectedStoreId` |
| G14 | No availability row for the pharmacy means **Hết hàng**; a failed request means "Chưa rõ tồn kho" | Both a missing row and a failed request leave the card with no badge, so it reads as in stock | `catalog.ts` `buildStockIndex`; `ProductCard.tsx` (`inStock === false`) |
| G15 | A sold-out card has a disabled **Hết hàng** button | The button stays enabled, with the secondary style | `ProductCard.tsx` (`disabled` expression) |
| G16 | A card with no price shows "Liên hệ báo giá" and a disabled **Chọn mua** | Shows "Liên hệ để báo giá" with an enabled **Chọn mua** | `ProductCard.tsx` |
| G17 | The disabled **Cần đơn thuốc** button has the reason as its accessible description | Disabled button with the label only; no description (the button is still correctly disabled and sends no request) | `ProductCard.tsx` |
| G18 | The footer **Danh mục** lists the groups and sub-categories and links to `/danh-muc/<slug>` | Lists raw category values linking to `/?danh-muc=<value>` on Home | `apps/customer-web/src/components/storefront/SiteFooter.tsx` |
| G19 | Sort is in the URL as `sap-xep`, as on Home | Sort is `useState` in the page, not in the URL; the route has no search schema | `CategoryPage.tsx`; `router.ts` (`/danh-muc/$slug`) |
| G20 | The user guide describes the group menu, sub-categories, the pharmacy stock line and "Xem thêm" | "Category (`/danh-muc/...`): products in one category." Incomplete; the spec is the target | `docs/user-guide.md` § Browsing and search |
