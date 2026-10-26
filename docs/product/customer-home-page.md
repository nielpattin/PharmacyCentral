# Home page

- **Status:** Current
- **App and route:** customer-web, `/`. Covers the shared header and footer as they appear on Home, and the 404 page (see Contents).
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[observed]` a code fact read on 2026-10-26; `[owner]` a recorded owner decision; `[standard]` a decision taken from industry practice (see Decisions). See [README](README.md).

## Purpose

- `[observed]` Home is the storefront entry. A shopper browses and searches the product list, filters it by category, sorts it, chooses a pharmacy to see its stock, and moves on to the cart or the order page.
- `[standard]` The page does three jobs in order: find a product, choose where it is collected or delivered, then act. Stock is shown for one pharmacy at a time, so the pharmacy finder sits on the same page, one step from the list (Decision 14).
- `[observed]` The hero says prices and fees are recalculated when the shopper orders. Prices and stock on Home are previews; the server decides the real values ([ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md)).
- `[owner]` The page must stay usable when WebGL is unavailable: an unavailable-map message replaces the map instead of crashing the page (owner, 2026-10-26; see [orders page](customer-orders-page.md), Contents).

## Users and entry points

- `[observed]` Anyone. Home makes no sign-in-only read: catalogue, prices, availability and pharmacies are public reads under the catalogue's public prefixes ([API guide](../api-guide.md), Catalog). Browsing works without an account ([user guide](../user-guide.md#browsing-and-search)). Only the header cart count reads the account cart, and only for a signed-in shopper.
- `[observed]` Entry points: `/`; the header logo; the footer category and service links; **Về trang chủ** on the 404 page.
- `[observed]` URL parameters: `q` (search text); `danh-muc` (raw catalogue category value); `sap-xep` (`default`, `price-asc`, `price-desc` or `name`; other values are dropped); `nha-thuoc` (pharmacy id). The hash `#nha-thuoc` scrolls to the pharmacy section on first load.

## User stories and acceptance criteria

### US1. As a shopper, I browse the catalogue and narrow it by search, category and sort, so that I find a product quickly

- Source: `[observed]`, matching the [user guide](../user-guide.md#browsing-and-search). Targets: Decisions 1, 2, 15, 16.
- Accepted when:
  - `/` shows, top to bottom: the hero, the quick actions, the product section (`#san-pham`), the pharmacy section (`#nha-thuoc`), then the footer.
  - With no search or category, the heading is **Tất cả sản phẩm** and the description gives the total of active products, read from `GET /api/products/count` (for example "128 sản phẩm"). (gap G1, G2)
  - Submitting "x" in the header search navigates to `/?q=x`, the heading becomes **Kết quả tìm kiếm**, the description contains `cho “x”`, and the page scrolls to `#san-pham`. Submitting an empty box removes `q`. A submit adds a history entry; a sort change replaces it.
  - **Xoá bộ lọc** appears only when a search or category is set. It removes `q` and `danh-muc` and resets the sort to **Mặc định**.
  - With no match the grid shows "Không tìm thấy sản phẩm phù hợp"; with an empty catalogue it shows "Chưa có sản phẩm nào". A failed load shows neither (see States).
  - **Xem thêm** loads the next page of 60 with the cursor until the list ends. (gap G2)
  - The sort options are **Mặc định**, **Giá thấp đến cao** (`sap-xep=price-asc`), **Giá cao đến thấp** (`price-desc`) and **Tên A - Z** (`name`). Each sort covers the whole result, not only the cards on screen; products without a price come last in price sorts. (gap G2)
  - A footer category (for example **Thuốc**) opens its category page `/danh-muc/<slug>` ([customer-category-page.md](customer-category-page.md), gap G26). The Home filter `/?danh-muc=<value>` stays for links that already use it, with heading **Kết quả tìm kiếm** and description "… trong Thuốc".

### US2. As a shopper, I add a product to my cart from the list

- Source: `[observed]`; rules BR-CART-001 and BR-CART-005. Targets: Decisions 4, 5, 7.
- Accepted when:
  - **Chọn mua** adds quantity 1 of the product's default sale unit. The line is unticked in the cart (BR-CART-001). The toast "Đã thêm “<name>” vào giỏ hàng" clears after about 4 seconds and the header badge rises by 1.
  - A failed add shows its message in the same toast, in Vietnamese. (gap G24)
  - A second click while the request is in flight does nothing; **Đang thêm...** appears after about 350 ms.
  - A prescription-only product (`prescriptionRequired`) shows a "Thuốc kê đơn" badge and a disabled **Cần đơn thuốc** button. No request is sent. (gap G9)
  - A sold-out product (`inStock: false` at the chosen pharmacy) shows a disabled **Hết hàng** button. No request is sent. (gap G7)
  - A signed-out shopper's add stays in the browser and sends no `/api/carts` request (BR-CART-005).

### US3. As a shopper, I see the price and stock of each product at the pharmacy I chose

- Source: `[observed]`; rules BR-PRICE-008, BR-INV-010, BR-QUALITY-003, BR-QUALITY-004. Targets: Decisions 3, 4, 7.
- Accepted when:
  - A card shows the price in force today in Asia/Ho_Chi_Minh, as `<amount>đ / <unit>` for its default unit (BR-PRICE-008). (gap G4)
  - Prices are read page by page until the last page (`X-Next-Cursor`) before the cards show them. (gap G3)
  - A product with no price in force shows "Liên hệ báo giá" and cannot be added. (gap G5)
  - A failed price read shows "Không tải được giá" with **Thử lại** on the affected cards, never "Liên hệ báo giá". (gap G6)
  - The **Hết hàng** badge shows when the chosen pharmacy's availability row says `inStock: false`. A product with no row shows "Chưa rõ tồn kho"; an availability read that fails shows the same label. (gap G8)
  - Choosing another pharmacy reloads `/api/availability?siteId=<id>`, and the badges change to match. A card shows the product image when it loads, otherwise a monogram.

### US4. As a shopper, I choose a pharmacy, see its stock, and find the nearest one

- Source: `[observed]`, matching the [user guide](../user-guide.md#browsing-and-search) ("Pharmacies"). Rule BR-MASTER-002. Targets: Decisions 6, 8, 11, 13, 17, 18, 19.
- Accepted when:
  - The list shows every active pharmacy flagged customer-facing (BR-MASTER-002), read page by page. The header band shows "N nhà thuốc đang hoạt động" with the same N. (gap G12)
  - With no valid `nha-thuoc` in the URL, the pharmacy remembered in this browser is selected; with none remembered, the first in code order. The selected button shows **Đang chọn** and `aria-pressed="true"`. An id in the URL that is not a customer-facing pharmacy is ignored. (gap G10, G11)
  - Choosing a pharmacy sets `nha-thuoc` in the URL, replacing the history entry, and remembers the choice in this browser. A pharmacy with no address shows "Chưa cập nhật địa chỉ".
  - **Tìm nhà thuốc gần bạn** is the only control that asks for the browser location. It is disabled while the request waits ("Đang định vị..."). When granted, the list becomes **Nhà thuốc gần vị trí của bạn** with at most 5 pharmacies, each with a distance in m or km, and the hint "Nhấn trên bản đồ hoặc kéo điểm đỏ để tìm nhà thuốc gần vị trí khác. Khoảng cách là đường chim bay."
  - When refused: "Bạn chưa cho phép truy cập vị trí". Without the Geolocation API: "Trình duyệt không hỗ trợ định vị".
  - **Xem tất cả nhà thuốc** returns to the full list and keeps the location for the next search. (gap G14)
  - Clicking the map, or dragging the red destination marker, repeats the nearest search for the new point. A click alone is enough; dragging is not required. (gap G15)
  - A chosen pharmacy with no coordinates shows "Nhà thuốc đang chọn chưa có toạ độ trên bản đồ." When the pharmacy list fails, the section shows "Không tải được danh sách nhà thuốc" and **Thử lại**, not that text. (gap G13)

### US5. As a shopper whose browser has WebGL off, I can still use Home

- Source: `[owner]` for the usable-page rule; `[observed]` for the mechanism. Targets: Decisions 9, 12.
- Accepted when:
  - With WebGL unavailable, the pharmacy section shows in place of the map a `role="status"` message that starts "Không hiển thị được bản đồ vì trình duyệt đang tắt WebGL". The message is Home copy, not checkout copy, and the drag hint is hidden. (gap G16)
  - The hero, the product list, the cart, the header and the footer work, and the page does not throw.
  - A build without `VITE_VIETMAP_TILEMAP_KEY` fails at build time. A deployed bundle never throws when it loads. (gap G17)

### US6. As a shopper, I use the header and footer links on Home

- Source: `[observed]`. Targets: Decisions 10, 11, 15, 20.
- Accepted when:
  - The top band links **Tìm nhà thuốc** to `/#nha-thuoc`, **Gửi đơn thuốc** to `/gui-don-thuoc`, and **Đơn hàng của tôi** to `/don-hang?tab=don-cua-toi`. **Tài khoản** links to `/tai-khoan`. **Giỏ hàng** links to `/don-hang` and shows a red badge with the sum of quantities of all cart lines, selected or not; the badge is hidden at 0.
  - **Tìm nhà thuốc** scrolls to `#nha-thuoc` on every click, including when Home is already open. (gap G20)
  - The header search box shows the URL's `q` at all times, including after **Xoá bộ lọc** and after back or forward. (gap G19)
  - The category bar and the footer categories list every category that has an active product in the catalogue, not a sample of the first 100 products. (gap G22)
  - The category bar shows one item per group that has a category in the catalogue. Each item links to `/danh-muc/<slug>`. On large screens (`lg`) a group with sub-categories opens a menu on hover or focus; each sub-category links to its page, and **Xem tất cả <group>** links to the group page. **Hệ thống nhà thuốc** links to `/#nha-thuoc`.
  - Footer categories link to `/danh-muc/<slug>` (gap G26). Footer services link to `/#nha-thuoc`, `/don-hang`, `/don-hang?tab=don-cua-toi` and `/tai-khoan`.
  - A failed category read shows "Không tải được danh mục" in the footer and hides the bar. It never shows "Đang cập nhật danh mục". (gap G23)
  - A 401 on the signed-in cart read ends the session as in Decision 6: a Vietnamese notice, sign-in at `/tai-khoan`, and a return to the page. (gap G21)

### US7. As a shopper who opens a page that does not exist, I return to Home

- Source: `[observed]`.
- Accepted when:
  - An unknown path (for example `/khong-co`) shows "404", the heading "Không tìm thấy trang" and the text "Đường dẫn bạn truy cập không tồn tại trong ứng dụng khách hàng."
  - **Về trang chủ** navigates to `/` and shows Home.

## Contents and behavior

The target page, top to bottom. Where the code differs, the Gaps table names the difference.

1. **Error banner** (only on error). Shows the message of the first failing read among pharmacies, prices, availability and the category list; if that is not an `Error`, "Không tải được dữ liệu nhà thuốc".
2. **Hero** (`HeroPanel`). Heading "Thuốc và vật tư y tế, nhận tại nhà thuốc hoặc giao tận nơi". Buttons **Xem sản phẩm** (scrolls to `#san-pham`) and **Xem nhà thuốc** (scrolls to `#nha-thuoc`; it does not ask for location, Decision 6). Three items: "Giao hàng tận nơi", "Nhận tại nhà thuốc", "SePay QR hoặc COD". The background image shows from the `lg` breakpoint.
3. **Quick actions** (six tiles). **Tìm nhà thuốc** scrolls to `#nha-thuoc` and does not request location. **Đơn của tôi** goes to `/don-hang?tab=don-cua-toi`. **Giao hàng**, **Nhận tại quầy**, **Thanh toán QR** and **Giỏ hàng** go to `/don-hang`.
4. **Product section** (`#san-pham`). Heading, sort select (aria label "Sắp xếp sản phẩm"), **Xoá bộ lọc** when filtered, the grid (2 to 5 columns by width), and **Xem thêm** when more pages exist.
   - Request: `GET /api/products` with `limit=60`, `search`, `category` and `cursor`. search-service serves it from the Typesense index, which holds active products only, with fallback to catalog-service ([ADR 0008](../adr/0008-search-service-in-go-on-typesense.md); [API guide](../api-guide.md)). A search is ranked by text; a search of three words or more is also embedded when an embedder is configured. A browse list (no search text) keeps the order the search service returns today, by SKU (Decision 1).
   - Card: the image or monogram and the name link to `/san-pham/<id>`. Then the manufacturer ("Đang cập nhật nhà sản xuất" when empty), a line with generic or active ingredient, strength and dosage form, the category label ("Chưa phân loại" when empty, "Khác" when not in the label table) and the unit. Then the price or its placeholder, then the button. A prescription-only card carries the "Thuốc kê đơn" badge (Decision 5).
   - Price: the published price in force today for the card's default unit (default sale unit, else base unit, else lowest sort order). Prices come from `GET /api/pricing/prices?status=Published&limit=500`, followed by `X-Next-Cursor` (Decision 3).
   - Stock badge: from `GET /api/availability?siteId=<chosen pharmacy>`.
5. **Pharmacy section** (`#nha-thuoc`). Heading "Hệ thống nhà thuốc", the button **Tìm nhà thuốc gần bạn**, and after a location is set **Xem tất cả nhà thuốc**. Left column: the pharmacy list (`GET /api/stores`, all pages) or, after a location is set, the nearest five (`GET /api/stores/nearest`). Right column: the map (`DeliveryMap`) with a blue marker for the chosen pharmacy; after a location is set it adds a red draggable marker and fits the view to both points. Map style and tiles come from Vietmap.
6. **Footer** (`SiteFooter`). Brand text, category and service lists, the payment list ("Chuyển khoản SePay QR", "Thanh toán khi nhận hàng", "Nhận tại nhà thuốc"), "Thanh toán được xác thực và đối soát tự động cho mọi đơn hàng.", and the bottom line "Giá thống nhất; tồn kho theo nhà thuốc bạn chọn." The copyright year is the current year.
7. **Header** (`SiteHeader`). A top band with the static line "Thuốc chính hãng · Giao hàng tận nơi · Nhận tại nhà thuốc", the pharmacy count and the three links in US6. A main row with the logo, the search form (`role="search"`, aria label "Tìm kiếm sản phẩm", placeholder "Tìm kiếm sản phẩm, tên thuốc, mã SKU...", button **Tìm kiếm**), **Tài khoản** and **Giỏ hàng**. A category bar under the band, hidden when no group has a category. The header reads the cart (`GET /api/carts` when signed in; the browser cart otherwise).
8. **404 page** (`NotFoundPage.tsx`, US7). Its own `<main>`, with no header or footer. The assistant launcher from `RootLayout` is not described here ([assistant spec](customer-shopping-assistant.md)).

## States

- `[observed]` Loading: 8 skeleton cards; 2 skeleton rows in the pharmacy list; grey bars in place of prices; "Đang tải danh mục sản phẩm" as the description. The category bar is hidden and the footer reads "Đang tải danh mục" until its read finishes.
- `[observed]` Product list failed: "Không hiển thị được sản phẩm. Vui lòng kiểm tra kết nối mạng và tải lại trang." in the grid, and the banner.
- Price list failed: "Không tải được giá" with **Thử lại** on each affected card (gap G6).
- Pharmacy list failed: "Không tải được danh sách nhà thuốc" with **Thử lại**; the map area shows no coordinates text (gap G13).
- Pharmacy list empty: "Chưa có nhà thuốc nào đang hoạt động".
- Category list failed: no category bar; the footer shows "Không tải được danh mục" (gap G23).
- Availability failed or no row for a product: "Chưa rõ tồn kho" on the card, never a blank (gap G8).
- Signed out: every section works; the cart count and adds use the browser cart.
- Unknown or non-customer-facing `nha-thuoc` in the URL: the default pharmacy in Decision 13 is used for stock and selection (gap G10).

## Out of scope

- Ranking products by sales, and any "Sản phẩm bán chạy" heading or "best seller" claim (Decision 1).
- Promotions, vouchers and personalised recommendations.
- Choosing a unit other than the default, or a quantity other than 1, from a card. The product page does that.
- A **Gửi đơn thuốc** link on a card (Decision 5).
- Product detail, category pages, the order page, the account, prescription intake and the assistant. See [product](customer-product-page.md), [category](customer-category-page.md), [orders](customer-orders-page.md), [account](customer-account-page.md), [prescription intake](customer-prescription-intake-page.md) and [assistant](customer-shopping-assistant.md).

## Rules and designs

- Business rules: [BR-MASTER-002](../business-rules.md) (customer-facing pharmacies), [BR-PRICE-008](../business-rules.md) (price in force), [BR-INV-010](../business-rules.md) (availability and "in stock"), [BR-INV-008](../business-rules.md) (stock checked at order), [BR-QUALITY-003](../business-rules.md) and [BR-QUALITY-004](../business-rules.md) (only released, unexpired batches count), [BR-CART-001](../business-rules.md) and [BR-CART-005](../business-rules.md) (cart lines and the browser cart), [BR-ORD-011](../business-rules.md) (prescription-only products), [BR-CHAT-001](../business-rules.md) (assistant needs sign-in), [BR-SYN-006](../business-rules.md) and [BR-SYN-007](../business-rules.md) (approved synonyms, search text folding).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices and stock are previews; the server checks them at order.
- [ADR 0008](../adr/0008-search-service-in-go-on-typesense.md): the product list is served by search-service.
- [ADR 0010](../adr/0010-fail-fast-environment-configuration.md): configuration fails fast, at build or boot, never in a shopper's browser.
- [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md): prescription-only products are not sold online.
- [User guide, Browsing and search](../user-guide.md#browsing-and-search) and the [API guide](../api-guide.md) (catalogue, pricing and store endpoints, cursors).
- [Category page](customer-category-page.md): the category bar and the footer category links.
- Standards: WCAG 2.2 AA (Success Criterion 2.5.7, Dragging Movements); Baymard Institute on out-of-stock handling.

## Decisions

Rows 1 to 14 answer every open question of the 2026-10-26 draft. Rows 15 to 20 add decisions that the storefront standards require. `[standard]` marks a decision from industry practice, not a recorded owner decision. "Owner may change" appears only in the Why column, and only for a business choice.

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | "Sản phẩm bán chạy" heading and browse order | `[owner]` 2026-10-26. Heading becomes **Tất cả sản phẩm** when nothing is filtered. The browse list keeps the order the search service returns today (by SKU); it is not ordered by name. Search keeps relevance. Ranking by sales is out of scope; no best-seller claim. No change to the Typesense index. | The page is a plain catalogue list with no sales data, so "bán chạy" was untrue. The owner chose a heading rename with no order change. |
| 2 | Only 60 products reachable without a search | `[standard]` **Xem thêm** loads 60 more with the cursor until the end. The count comes from `GET /api/products/count`. | A silent cap hides products. The API already offers the cursor and the count. |
| 3 | Price list capped at 500 | `[standard]` Read every page of published prices before showing prices. A product with no price after the full read shows "Liên hệ báo giá"; a failed read shows "Không tải được giá". | A priced product labelled "contact us" loses the sale. The price endpoint already pages. |
| 4 | Sold-out cards stay orderable | `[standard]` Keep the card. **Chọn mua** becomes a disabled **Hết hàng** button. The card suggests another pharmacy and links to the product page, where related products are the alternatives ([product spec](customer-product-page.md)). | Never leave a shopper at a dead end (Baymard). The server still checks stock at order (BR-INV-008). |
| 5 | Prescription-only card link | `[standard]` No link on the card. The card shows a "Thuốc kê đơn" badge and a disabled **Cần đơn thuốc** button. The product page carries **Gửi đơn thuốc**. | ADR 0016 and the one-action-per-card rule. The route to buy is on the product page. |
| 6 | "Tìm nhà thuốc" quick action says "Theo vị trí của bạn" but only scrolls | `[standard]` The tile and the hero button scroll to the pharmacy section and never ask for location. Their detail reads "Xem nhà thuốc và bản đồ" (hero: **Xem nhà thuốc**). Only **Tìm nhà thuốc gần bạn** asks for location. | A label must match its action, and a location prompt should follow a control that says so. |
| 7 | Stock for a product with no availability row | `[standard]` Show "Chưa rõ tồn kho" in neutral style. The product stays purchasable; the server checks stock at order (BR-INV-008). | No row means no stock record, not a confirmed zero. "Hết hàng" would be a guess. Blocking would hide stock the pharmacy may hold. |
| 8 | Pharmacy list error reads as "no coordinates" | `[standard]` A failed list shows "Không tải được danh sách nhà thuốc" with **Thử lại**. The coordinates text shows only for a chosen pharmacy that has none. | Fail visibly; an error must never look like an empty or incomplete result. |
| 9 | Map-unavailable copy on Home | `[standard]` Home copy: "Không hiển thị được bản đồ vì trình duyệt đang tắt WebGL (thử bật tăng tốc phần cứng). Danh sách nhà thuốc và địa chỉ vẫn xem được." The map drag hint is hidden without a map. | Checkout wording ("nhập địa chỉ và đặt hàng") does not fit Home, and the hint describes an action that cannot happen without a map. |
| 10 | Header search text not synced | `[standard]` The box always shows the URL's `q`. | The box must show what the list is filtered by. |
| 11 | Header "Tìm nhà thuốc" when already on Home | `[standard]` It scrolls to `#nha-thuoc` on every click. | A link that does nothing on the page it names looks broken. |
| 12 | Missing map key | `[standard]` Keep fail-fast. The customer-web Vite config throws at `vite build` when `VITE_VIETMAP_TILEMAP_KEY` is empty. Browser code does not repeat the check, and Home needs no runtime fallback for a missing key. | [ADR 0010](../adr/0010-fail-fast-environment-configuration.md) puts configuration checks at build or boot. A bundle without the key must not ship. A throw when the module loads blanks the whole app, including the header and the assistant. The WebGL fallback covers the browser only. |
| 13 | Default pharmacy | `[standard]` Stock and selection use, in order: the valid `nha-thuoc` in the URL; the pharmacy the shopper chose before, remembered in this browser; the first customer-facing pharmacy in code order. No pharmacy is picked by location without a click. | Stock must name one pharmacy, and the code order is the only stable order. Owner may change: which pharmacy a new shopper sees first is a business choice. |
| 14 | Why Home holds the hero, quick actions and pharmacy finder | `[standard]` Home serves three jobs in order: find a product, choose where it is collected or delivered, then act. Its purpose is stated in Purpose. | A storefront home page is one place to start. Keeping the pharmacy choice one step from the list keeps stock and collection clear. |
| 15 | Category bar and footer built from the first 100 products (new) | `[standard]` Every category with an active product appears. The read is not capped to a sample. Engineering chooses the endpoint. | A category missing from the first 100 products is unreachable from the menu. |
| 16 | Sort applies to loaded cards only (new) | `[standard]` A sort covers the whole result. A price sort loads the remaining pages first and shows "Đang tải danh mục sản phẩm" while it does. | Sorting a partial list gives a wrong order without any sign. |
| 17 | Pharmacy list capped at 50 (new) | `[standard]` All customer-facing pharmacies, read page by page; the header count uses the full total. | A silent cap drops pharmacies; the header count would lie. |
| 18 | No way back from the nearest list (new) | `[standard]` **Xem tất cả nhà thuốc** returns to the full list and keeps the location. | A state with no exit is a dead end. |
| 19 | Map changed only by dragging (new) | `[standard]` A click on the map moves the destination marker. Dragging remains as well. | WCAG 2.2 SC 2.5.7 (Dragging Movements, AA): a single pointer action must do the same job. |
| 20 | Header cart read and a 401 (new) | `[standard]` A 401 ends the session as in Decision 6: notice, sign-in, return. The badge is not silently hidden. | A failed session must be visible, not an empty badge. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Heading **Tất cả sản phẩm** when nothing is filtered (Decision 1). | Heading **Sản phẩm bán chạy**. | `apps/customer-web/src/components/storefront/CatalogSection.tsx` (line 47). |
| G2 | Total from `/api/products/count`; **Xem thêm** with the cursor; every sort over the whole result (Decisions 2, 16). | One request, `limit=60`, no cursor, no load more. The description counts loaded cards. Sorting runs in the browser over loaded cards. | `CatalogSection.tsx`; `apps/customer-web/src/customer-api.ts` (`listProducts`). API guide, Catalog, already defines `cursor`, `X-Next-Cursor` and `/api/products/count`. |
| G3 | All published price pages read (Decision 3). | One request, `limit=500`, no cursor. Products beyond the 500th row show "Liên hệ để báo giá". | `apps/customer-web/src/customer-api.ts` (`listPublishedPrices`); [API guide](../api-guide.md) (`GET /api/pricing/prices`, `X-Next-Cursor`). |
| G4 | Price in force today in Asia/Ho_Chi_Minh. | Today is `new Date().toISOString()`, the UTC date. Between 00:00 and 07:00 Vietnam time, a price that starts today is not yet shown. | `apps/customer-web/src/pages/HomePage.tsx` (`buildPriceIndex`); `customer-api.ts` (`getActivePrice` uses the same UTC date). |
| G5 | No-price product: "Liên hệ báo giá", not addable. | Copy is "Liên hệ để báo giá". The button stays enabled when there is no price. | `apps/customer-web/src/components/storefront/ProductCard.tsx`. |
| G6 | A failed price read shows "Không tải được giá" with **Thử lại** on the card. | A failed read leaves `pricesPending` false, so every card shows the no-price copy. Only the banner names the error. | `ProductCard.tsx`; `HomePage.tsx` (`pricesQuery`). |
| G7 | Sold-out product: disabled **Hết hàng** button (US2). | **Chọn mua** is enabled; the badge is a secondary style only. | `ProductCard.tsx` (`disabled` has no stock term). |
| G8 | "Chưa rõ tồn kho" when there is no row or the read fails (US3). | No label. The card shows only the sold-out badge. | `ProductCard.tsx`; `apps/customer-web/src/storefront/catalog.ts` (`buildStockIndex`). |
| G9 | "Thuốc kê đơn" badge on the card, plus disabled **Cần đơn thuốc** (Decision 5). | Disabled **Cần đơn thuốc** button only; no badge. | `ProductCard.tsx`. |
| G10 | Unknown or non-customer-facing `nha-thuoc` is ignored (Decision 13). | The id is used for availability, so no card shows a badge; the map falls back to the first pharmacy. | `HomePage.tsx` (`readFilters`, `storeId: search["nha-thuoc"] ?? stores[0]?.id`). |
| G11 | The chosen pharmacy is remembered in this browser (Decision 13). | Only the URL and the first pharmacy are used. Nothing is stored. | `HomePage.tsx` (`readFilters`); no browser storage for the pharmacy. |
| G12 | All customer-facing pharmacies, page by page; header count from the full total. | `GET /api/stores?limit=50`, one page. The header count is the loaded length. | `apps/customer-web/src/customer-api.ts` (`listStores`); `HomePage.tsx` (`storeCount`); [API guide](../api-guide.md) (`GET /api/stores`, `X-Next-Cursor`). |
| G13 | A failed list shows its error with **Thử lại**; coordinates text only for a chosen pharmacy without coordinates. | A failed list shows no message in the section. The map area shows "Nhà thuốc đang chọn chưa có toạ độ trên bản đồ." | `apps/customer-web/src/components/storefront/StoreFinder.tsx`. |
| G14 | **Xem tất cả nhà thuốc** returns to the full list (Decision 18). | No control; the nearest list replaces the full list until a reload. | `StoreFinder.tsx` (`visibleStores = nearest ?? stores`). |
| G15 | A click on the map moves the destination (Decision 19). | Only `dragend` on the marker moves it. | `apps/customer-web/src/components/DeliveryMap.tsx`. |
| G16 | Home copy for WebGL-off; no drag hint without a map (Decision 9). | Shared checkout copy ("nhập địa chỉ và đặt hàng") from `MapUnavailable`; the drag hint shows regardless. | `apps/customer-web/src/components/map-support.tsx`; `StoreFinder.tsx` (drag hint). |
| G17 | Missing key fails at `vite build`; the bundle never throws on load (Decision 12, ADR 0010). | `components/vietmap-style.ts` throws at module load when the key is empty. The customer-web Vite config has no check. The throw blanks the whole app, because Home imports the module through the pharmacy section. | `apps/customer-web/src/components/vietmap-style.ts`; `apps/customer-web/vite.config.ts`. ADR 0010 is right; the code is wrong. |
| G18 | Hero button **Xem nhà thuốc** and quick-action detail "Xem nhà thuốc và bản đồ" (Decision 6). | Hero reads **Tìm nhà thuốc gần bạn** and the tile detail reads "Theo vị trí của bạn", but neither asks for location. | `apps/customer-web/src/components/storefront/HeroPanel.tsx`; `QuickActions.tsx`. |
| G19 | Header search box follows the URL's `q` (Decision 10). | The box copies `q` on mount only (`useState(searchTerm)`). | `apps/customer-web/src/components/storefront/SiteHeader.tsx`. |
| G20 | **Tìm nhà thuốc** scrolls on every click (Decision 11). | Scroll runs on mount only (`useMountEffect` in `HomePage.tsx`). The header link on Home changes only the hash. Not checked in a browser. | `HomePage.tsx`; `SiteHeader.tsx` (`href="/#nha-thuoc"`). |
| G21 | A 401 on the cart read ends the session visibly (Decision 20). | A 401 ends the session and opens the sign-in form as a dialog over the page, with "Phiên đã hết hạn. Vui lòng đăng nhập lại." (`customer-api.ts` `endCustomerSessionAfter401`; `components/account/SessionEndedDialog.tsx`). Sign-in is not at `/tai-khoan`, and the notice wording differs. A failure that is not a 401 still counts as zero, so the badge hides silently. | `SiteHeader.tsx` (`cartQuery`). |
| G22 | Category bar and footer from every active category (Decision 15). | Both read `GET /api/products?limit=100` and use only the categories of those 100 products. | `HomePage.tsx`; `SiteHeader.tsx`; `apps/customer-web/src/components/storefront/SiteFooter.tsx`. |
| G23 | A failed category read shows "Không tải được danh mục" (US6). | The footer shows "Đang cập nhật danh mục", the same text as an empty catalogue. | `SiteFooter.tsx`. |
| G24 | Vietnamese text for every user-visible error. | `request()` shows the server's `detail` or `title` verbatim; some are English (BR-INV-008 gives "Insufficient stock"). The toast and the banner show that text. | `apps/customer-web/src/customer-api.ts` (`request`); `apps/customer-web/src/hooks/useAddToCart.ts`. |
| G25 | The assistant needs a signed-in customer (BR-CHAT-001). | [User guide](../user-guide.md#customer-web), "Customer Web", says browsing, searching and the assistant "work without an account". | `docs/user-guide.md`, section "Sign in", subsection "Customer Web", the paragraph under the steps (line 55). The business rule is right; the user guide is wrong. |
| G26 | The footer **Danh mục** links to `/danh-muc/<slug>` (see [customer-category-page.md](customer-category-page.md), Decision 2) | Links to `/?danh-muc=<value>` on Home | `apps/customer-web/src/components/storefront/SiteFooter.tsx` |
