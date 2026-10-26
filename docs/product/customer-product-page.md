# Product detail page

- **Status:** Current
- **App and route:** customer-web, `/san-pham/$productId` (`apps/customer-web/src/router.ts`, `pages/ProductDetailPage.tsx`)
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` a recorded owner decision (ADR 0014 to 0016, orders spec), `[observed]` a code fact read on 2026-10-26, `[standard]` a decision from industry practice (see Decisions). See [README](README.md).

## Purpose

- `[observed]` The page shows one product so a shopper can decide to buy it: image, name, sale unit and price, stock at the pharmacy they chose, and product facts. From here they add it to the cart or buy it now.
- `[standard]` The stock panel answers the question a pharmacy shopper has before adding: does the pharmacy my order will come from have it? It is shown for that one pharmacy only (Decision 1). The product facts let the shopper confirm the right product.
- `[owner]` A prescription-only product (`prescriptionRequired`) is not sold online. The page shows a notice and a **Gửi đơn thuốc** link instead of buy controls ([ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md)).
- `[owner]` **Mua ngay** adds the product, ticks that line and opens `/don-hang` ([orders spec](customer-orders-page.md), US1a).

## Users and entry points

- `[observed]` Anyone. Viewing the page, adding to the cart and **Mua ngay** need no sign-in. A signed-out cart stays in this browser ([ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md), BR-CART-005).
- `[observed]` Entry points: product cards and names on Home and Category, product names in the cart, product results of prescription intake, product cards in shopping assistant answers, and direct links. The shared header and footer appear on the page.
- `[standard]` Shopping assistant product cards link here. For a prescription-only product they show the badge and the link, no price and no cart action (Decision 14) (gap G15).

## User stories and acceptance criteria

### US1. As a shopper, I see what the product is, its price and whether I can get it, so that I can decide to buy it

- Source: `[observed]`; labels as in D7 and D8.
- Accepted when:
  - The product name is the `h1`. The badges row shows the category label, then the stock badge for the chosen pharmacy (US6), then "Thuốc kê đơn" for a prescription-only product.
  - Under the name: the manufacturer, or "Đang cập nhật nhà sản xuất" when empty; then "ingredient · strength · dosage form", with terms translated by `productMetadataLabel`.
  - The image fills a square tile. With no image, or when it fails to load, the tile shows the product's initials.
  - Breadcrumb: "Trang chủ", then the category page label (or the category label when it has no page), then the product name.
  - An unknown or discontinued product shows the not-found state (US7).

### US2. As a shopper, I choose the sale unit and quantity, and see the price for them

- Source: `[observed]`; prices are chain-wide, one per unit in effect (BR-PRICE-004, BR-PRICE-008).
- Accepted when:
  - With two or more units, **Đơn vị bán** is a select (aria-label "Chọn đơn vị bán"). Each option reads the unit name, then " · <price>" when that unit is priced. The default unit is the default sale unit, else the base unit, else the lowest `sortOrder`.
  - With one unit, its name is text. With no unit, the danger alert "Sản phẩm chưa có đơn vị bán nên chưa thể đặt hàng." replaces the quantity and both buy controls are disabled.
  - The price reads `<price> / <unit name>` using the price in effect on today's date in Asia/Ho_Chi_Minh (gap G6), found for every product, not only those on the first page of prices (gap G9).
  - No price for the chosen unit: "Liên hệ báo giá" and both buy controls disabled (Decision 3) (gap G4).
  - The price request failed: "Không tải được giá" with **Thử lại**, and buy controls disabled until a price loads (Decision 4) (gap G5).
  - **Số lượng** starts at 1. **−** (aria "Giảm số lượng") is disabled at 1; **+** (aria "Tăng số lượng") is disabled at 999. The field keeps digits only, at most three; on blur an empty or zero value becomes 1.
  - Every control has a visible label and a visible focus ring, and works by keyboard (WCAG 2.2 AA; D16). Smoke run with keyboard only.

### US3. As a shopper, I add the product to the cart without ticking it

- Source: `[owner]` 2026-10-26 for "unticked" (orders spec US1); `[observed]` for the controls.
- Accepted when:
  - **Thêm vào giỏ hàng** adds the chosen unit at the chosen quantity. The label changes to "Đang thêm..." only when the request takes longer than 350 ms. A second click on the same product is ignored while the first is in flight.
  - The new line is unticked (BR-CART-001). The notice "Đã thêm “<product name>” vào giỏ hàng" appears in the live region at the bottom of the screen and clears after about 4 seconds. A failure shows its message in the same place, or "Không thêm được sản phẩm vào giỏ hàng" when the error has no message.
  - Adding a product already in the cart adds to its line and keeps its tick.
  - Both controls are disabled while the chosen pharmacy shows the product as "Hết hàng" (Decision 2) (gap G3), and while the chosen unit has no price (Decision 3) (gap G4).
  - Smoke run, signed in: the line appears in `GET /api/carts` and the header count rises. Signed out: no `/api/carts` request is sent (`customer-api.test.ts`).

### US4. As a shopper, I press "Mua ngay" and land on the order page with that line ticked

- Source: `[owner]` 2026-10-26 (orders spec US1a; the exception in BR-CART-001).
- Accepted when:
  - The product is added, its line is ticked (`PATCH /api/carts/selection` with that line's id, or the browser cart when signed out), and the page opens `/don-hang`.
  - Other lines keep their ticks.
  - If the tick fails after the add succeeded, the page still opens `/don-hang` and the line is there unticked.
  - If the add fails, the page stays and shows the error notice.
  - The disabled rules of US3 apply to **Mua ngay** too.

### US5. As a shopper, I cannot put a prescription-only product in the cart here, and I am sent to the prescription route

- Source: `[owner]` ADR 0016 and BR-ORD-011 (2026-10-26).
- Accepted when:
  - No add-to-cart or buy control and no quantity control. The warning alert "Thuốc kê đơn không đặt online" shows "Gửi đơn thuốc để dược sĩ hỗ trợ, hoặc đến nhà thuốc để mua theo đơn." and a **Gửi đơn thuốc** link to `/gui-don-thuoc`.
  - The unit and price stay visible as reference, with no buy control (Decision 7).
  - A signed-out shopper sees the same.
  - Server: `POST /api/carts/lines` and `POST /api/orders` answer 409 `prescription_required` (BR-ORD-011). Covered by `sales-service/src/modules/sales-routes.test.ts`; the signed-out refusal by `customer-api.test.ts`.

### US6. As a shopper, I see whether the product is in stock at the pharmacy I chose

- Source: `[standard]` (Decision 1, D7); `[observed]` for today's all-pharmacy list.
- Accepted when:
  - The chosen pharmacy is the one the shopper picked and that the browser remembers. Until a choice is made, the first customer-facing pharmacy by code is used and its name is shown (as Home does today) (gap G2).
  - Card **Tình trạng tại nhà thuốc** shows the chosen pharmacy's name and address, a select (aria-label "Chọn nhà thuốc") of every customer-facing, active pharmacy, and one status: "Còn hàng" when its row says in stock; "Hết hàng" when not; "Đang cập nhật tồn kho" when no row exists; "Không tải được tồn kho" when the request failed (gap G14). "Cập nhật <date and time>" appears under an existing row, in Asia/Ho_Chi_Minh (gap G6).
  - The header badge shows the same status for the chosen pharmacy. No other pharmacy's stock is shown on this page (gap G1).
  - Changing the pharmacy here changes it on Home and on `/don-hang` (gap G2).
  - "In stock" means sellable available quantity above zero (BR-INV-010, BR-QUALITY-003). Availability is requested for the chosen pharmacy only (gap G12).
  - Every customer-facing pharmacy is listed; no page is silently dropped (gap G10).

### US7. As a shopper, a product I cannot open gets a clear Vietnamese message

- Source: `[standard]` (D7); `[observed]` for the current text.
- Accepted when:
  - An unknown id, or a discontinued product (`isActive` false), shows the heading "Không tìm thấy sản phẩm", the text "Sản phẩm này không còn bán hoặc đường dẫn không đúng." and **Về trang chủ** (gaps G7, G8).
  - Any other load failure shows "Không tải được sản phẩm", **Thử lại** and **Về trang chủ**. The server's English title is never shown (gap G8).
  - A failed load is never shown as "not found".
  - Smoke run: `/san-pham/<unknown uuid>` shows the Vietnamese not-found text and no English words.

### US8. As a shopper, I can browse related products

- Source: `[observed]`.
- Accepted when:
  - **Sản phẩm cùng danh mục** lists up to five other active products from the same category, with price and stock for the chosen pharmacy. The section is absent when the product has no category or no other product matches.
  - **Xem tất cả** links to the category page whenever the category has one, judged against the complete category list (gap G11). The breadcrumb follows the same rule.
  - Each related card has its own add control (`ProductCard`), not described here.

### US9. As a signed-out shopper, my cart stays in this browser

- Source: `[owner]` 2026-10-26 (design 0005, ADR 0014); BR-CART-005.
- Accepted when:
  - Add, tick and **Mua ngay** work with no sign-in. The line is stored under `localStorage` key `pharmacy.guest-cart.v1`, survives a reload, and is not visible in another browser.
  - No `/api/carts*` request is sent while signed out (`customer-api.test.ts`).
  - On sign-in, the browser lines go once to `POST /api/carts/merge` and are cleared after the server accepts them (`customer-api.test.ts`).
  - The page shows no sign-in prompt. Ordering needs sign-in (BR-ORD-001), handled on `/don-hang`.

## Contents and behavior

`[observed]` unless marked. In order, top to bottom:

1. Breadcrumb (US1).
2. Two columns. Left: the image tile. Right: badges, name, manufacturer, metadata line, a price card (price, unit, quantity and buy controls, or the prescription notice), then three static labels: "Thuốc chính hãng", "Giao hàng tận nơi", "Nhận tại nhà thuốc". `[standard]` They are standing commitments, kept as stated (Decision 12).
3. **Thông tin sản phẩm**, a definition list: "Mã sản phẩm (SKU)", "Danh mục" (always shown; "Chưa phân loại" when empty), "Nhà sản xuất", "Hoạt chất" (falls back to the generic name), "Công dụng", "Hàm lượng", "Dạng bào chế", "Quy cách đóng gói", "Số đăng ký", "Mã vạch", "Đơn vị bán". Empty values are hidden.
4. **Tình trạng tại nhà thuốc**: the US6 card.
5. **Ghi chú**, only when the product has notes; line breaks are kept. `[standard]` The notes are customer-facing text (Decision 15) (gap G16).
6. **Sản phẩm cùng danh mục**: US8.
7. The add-to-cart notice (`CartFeedback`, floating at the bottom), then the footer.

Data the page reads: the product (`GET /api/products/{id}`); published prices (`GET /api/pricing/prices?status=Published`, every page, filtered in the browser to today in Asia/Ho_Chi_Minh); availability (`GET /api/availability?siteId=<chosen pharmacy>`); customer-facing pharmacies (`GET /api/stores`, every page); categories and related products (`GET /api/products`, served by search-service per [ADR 0008](../adr/0008-search-service-in-go-on-typesense.md)). Cart writes go through `useAddToCart`, to `addCartLine` and `setCartSelection` in `customer-api.ts`. The product list shows active products only; the product lookup does not yet (gap G7).

Not on the page: an image gallery or zoom; reviews; a quantity per pharmacy; a stock hold (stock is held only when an order is placed, BR-ORD-004).

## States

- `[observed]` **Loading:** "Đang tải sản phẩm…" (`role="status"`). No product layout is drawn until the product arrives.
- `[standard]` **Not found or load failed:** US7.
- `[observed]` **Price loading:** a grey placeholder in place of the price.
- `[standard]` **No price:** "Liên hệ báo giá", buy controls disabled. **Price request failed:** "Không tải được giá" with **Thử lại**, buy controls disabled.
- `[standard]` **Side load failed** (categories, related products, pharmacies, availability): a danger alert above the product names what failed, in Vietnamese; the product stays visible. Stock shows "Không tải được tồn kho", never "Đang cập nhật tồn kho" or "Hết hàng".
- `[standard]` **Pharmacies:** "Đang tải nhà thuốc…" while loading; "Không tải được danh sách nhà thuốc." on error; "Chưa có nhà thuốc nhận đơn." when the list is empty.
- `[standard]` **Out of stock at the chosen pharmacy:** "Hết hàng" badge, price muted, buy controls disabled. The card suggests "Chọn nhà thuốc khác để xem tồn kho" when another pharmacy exists; related products are the alternatives (Decision 2).
- `[observed]` **No units:** danger alert, buy controls disabled (US2). **Prescription-only:** warning alert and link (US5).
- `[observed]` **Adding:** "Đang thêm..." after 350 ms; repeat clicks ignored while in flight (US3).
- `[standard]` **Session ended:** a cart call that still returns 401 after one identity refresh shows "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại." with a sign-in link; after sign-in the shopper returns to this page (D6) (gap G13).

## Out of scope

- `[observed]` An image gallery, zoom or lightbox.
- `[standard]` Choosing the order's pharmacy and fulfilment; that is on `/don-hang` (BR-ORD-003). This page only shows stock for the chosen pharmacy.
- `[observed]` Buying a prescription-only product here, or reading a prescription on this page. The route is `/gui-don-thuoc` (ADR 0016).
- `[observed]` Changing quantities of lines already in the cart; that is on `/don-hang`.
- `[observed]` Reviews, ratings and product comparison.

## Rules and designs

- Business rules: BR-CART-001, BR-CART-002, BR-CART-003, BR-CART-005, BR-ORD-001, BR-ORD-002, BR-ORD-004, BR-ORD-011, BR-PRICE-004, BR-PRICE-008, BR-INV-010, BR-QUALITY-003, BR-MASTER-002 in [business-rules.md](../business-rules.md).
- ADRs and designs: [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md) (prices, stock and fees are the server's), [ADR 0008](../adr/0008-search-service-in-go-on-typesense.md), [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md), [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md), [design 0004](../design/0004-order-from-selected-cart-lines.md), [design 0005](../design/0005-client-only-guest-cart.md).
- User guide: [Browsing and search](../user-guide.md#browsing-and-search), [Cart and checkout](../user-guide.md#cart-and-checkout).
- Tests: `apps/customer-web/src/customer-api.test.ts` (signed-out cart, merge, prescription refusal), `apps/customer-web/src/storefront/guest-cart.test.ts`, `apps/sales-service/src/modules/sales-routes.test.ts`. No component test covers this page, so the UI criteria need a smoke run.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| 1 | Stock is shown for every pharmacy, though the pharmacy is chosen only at checkout. Which is intended? | `[standard]` Stock is shown for one pharmacy: the one the shopper picked and the browser remembers. The card has a selector and the header badge follows it. Other pharmacies' stock is not listed. | A cart order is held at one pharmacy (BR-ORD-004), so other pharmacies' stock invites a choice the cart cannot honour. The [user guide](../user-guide.md#browsing-and-search) already says stock is for the selected pharmacy. D7. |
| 2 | Out-of-stock products can be added and bought. | `[standard]` Out of stock at the chosen pharmacy: "Hết hàng", add and buy disabled. Alternatives: another pharmacy, or the related products. A row that is missing (unknown stock) does not disable buying; the server checks at order. | Baymard: never leave a shopper at a dead end. The order is the stock authority (ADR 0004, BR-ORD-004). |
| 3 | Unpriced products can be added. | `[standard]` No price in effect for the chosen unit: "Liên hệ báo giá", add and buy disabled. | A line that cannot be ordered only fails later at checkout (BR-ORD-001, `product_unpriced`). D7. |
| 4 | A failed price request looks like no price. | `[standard]` A failed load shows "Không tải được giá" with **Thử lại**; buy controls wait for a price. | Fail visibly, never as "no price" (D7, D14). |
| 5 | Inactive products open directly. | `[standard]` A discontinued product (`isActive` false) answers not found to shoppers, as lists already do. Staff-web reads it unchanged. Cart adds of it are refused. | Product lists already hide it, so a direct link must match. Staff need the record to reactivate it. D7. |
| 6 | Not-found copy is the catalog's English title. | `[standard]` Vietnamese text per US7. Server failures show "Không tải được sản phẩm" with **Thử lại**. | D7: every user-visible error is Vietnamese, and a load error is never "not found". |
| 7 | Prescription wording: "Cần đơn thuốc" button, or the notice? | `[standard]` On this page the notice and **Gửi đơn thuốc** replace the buy controls, and the unit and price stay visible as reference. "Cần đơn thuốc" is the label of the disabled add button on cards, picker and results. "Thuốc kê đơn" is the one badge wording. | ADR 0016 says the link replaces the buy buttons on this page; BR-ORD-011 names the disabled add button, which this page does not have. D8. |
| 8 | The price day uses the UTC date. Should "today" be Vietnam time? | `[standard]` Yes. "Today" is the Asia/Ho_Chi_Minh date, for prices and for "Cập nhật" times. | From 00:00 to 07:00 in Vietnam, the UTC date is the previous day, so the wrong price shows. Pharmacy prices follow the Vietnamese calendar. D7. |
| 9 | The price list reads one page of 500 and ignores the cursor. | `[standard]` Read every page (`X-Next-Cursor`) until no further page is announced. | A silent cap hides prices. D7 (lists page or load more). |
| 10 | Availability loads the whole table and filters in the browser. Is that accepted? | `[standard]` No. Request availability for the chosen pharmacy (`siteId`). | The route already takes `siteId` and `productId`. A shopper needs one pharmacy's rows (D7). |
| 11 | Pharmacy list capped at 50. | `[standard]` Read every page of customer-facing pharmacies. | D7; the route pages with `X-Next-Cursor`. |
| 12 | Are "Thuốc chính hãng", "Giao hàng tận nơi" and "Nhận tại nhà thuốc" standing commitments? | `[standard]` Keep them. The two delivery labels match the two fulfilment choices at checkout (BR-ORD-003). "Thuốc chính hãng" must be backed by supplier purchase orders and batch release before sale (BR-RECV-008, BR-QUALITY-003). Owner may change: they are public commitments. | A public claim is a business decision for the owner; the rest follows from how stock arrives and is checked. |
| 13 | Why does the page show per-pharmacy stock and product facts? | `[standard]` Purpose: show before the add whether the order's pharmacy has the product, and let the shopper confirm the product. Keep both. | Avoids an add that then fails at order (BR-ORD-004). Common practice puts identity and availability on one product page. |
| 14 | Chat cards for a prescription-only product. | `[standard]` Badge "Thuốc kê đơn" and the link, no price, no cart action (D8). | Same rule as this page: not sold online, so the card offers no purchase. The compact card also omits the price, as D8 sets. |
| 15 | Who reads the product notes? | `[standard]` Notes are customer-facing text: use, storage and caution. Internal remarks do not go there, and the staff field says so. | Shoppers see this field, so it must be written for them. |
| 16 | A cart call returns 401. | `[standard]` D6: a visible Vietnamese notice, sign-in, return to this page. | D6 applies to every page. |

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | Stock for the chosen pharmacy only (Decision 1). | Card lists every pharmacy with its own status; header "Còn hàng" is true when any pharmacy has stock. Code is behind; the user guide already states the target. | `pages/ProductDetailPage.tsx` (stock card, badge); `storefront/catalog.ts` `buildStockIndex` |
| G2 | One remembered pharmacy across Home, product page, category and `/don-hang` (Decision 1). | Home reads `?nha-thuoc=` and defaults to the first store; `/don-hang` keeps its own state defaulting to the first store; nothing is remembered. The [user guide](../user-guide.md#browsing-and-search) describes only the Home finder. Code is behind; the guide must add the remembered choice. | `pages/HomePage.tsx` (`readFilters`); `pages/OrdersHubPage.tsx` (`selectedStoreId`) |
| G3 | Out of stock disables add and buy (Decision 2). | Buttons stay enabled; out of stock only changes the add button's style to `variant="secondary"`. | `pages/ProductDetailPage.tsx` buy row |
| G4 | No price disables add and buy (Decision 3). | Add and buy enabled; the line enters the cart and checkout refuses it (BR-ORD-001). | `pages/ProductDetailPage.tsx` buy row; `customer-api.ts` `addCartLine` |
| G5 | "Liên hệ báo giá" only when there is no price; "Không tải được giá" with retry on failure (Decision 4). | A failed price request shows "Liên hệ để báo giá", the same as no price. The wording differs from "Liên hệ báo giá" in `components/checkout/CartItems.tsx`, `components/storefront/ChatbotWidget.tsx` and `components/storefront/PrescriptionResults.tsx`. | `pages/ProductDetailPage.tsx` price card |
| G6 | "Today" and times in Asia/Ho_Chi_Minh (Decision 8). | Price day from `new Date().toISOString()` (UTC). `dateTimeFormatter` in `storefront/format.ts` has no `timeZone`, so "Cập nhật" uses the browser's zone. The catalog's base-price route also defaults to UTC (`catalog-routes.ts`, `/pricing/base-prices`). | `pages/ProductDetailPage.tsx` (`buildPriceIndex`); `storefront/format.ts` |
| G7 | A discontinued product is not found for shoppers, and the cart refuses it (Decision 5). | `GET /api/products/:id` returns inactive products; the product list filters them (`productListFilters`). sales-service has no product `isActive` check on cart adds. The [user guide](../user-guide.md#browsing-and-search) is silent. Code is behind. | `catalog-service` `catalog-routes.ts` (`/products/:id`), `drizzle-store-repository.ts` `getProduct`; `sales-service` `sales-routes.ts` (`/carts/lines`) |
| G8 | Vietnamese not-found and error copy with retry (Decision 6). | The client shows the server's `detail ?? title`, so "Product not found" appears; no retry. | `customer-api.ts` `request` (error text); `catalog-routes.ts` (`/products/:id` 404 title); `pages/ProductDetailPage.tsx` error block |
| G9 | Every published price is read (Decision 9). | `listPublishedPrices` reads one page of 500 and ignores `X-Next-Cursor`, which `/pricing/prices` sets. A product whose price is past that page shows "Liên hệ báo giá" wrongly. | `customer-api.ts` `listPublishedPrices` |
| G10 | Every customer-facing pharmacy is read (Decision 11). | `listStores` requests `limit=50` and ignores `X-Next-Cursor`, which `/api/stores` sets. | `customer-api.ts` `listStores` |
| G11 | A complete category list, so "Xem tất cả" and the breadcrumb link work for any category (US8). | Categories are taken from one page of products (`listProducts({ limit: 100 })`), the maximum page; the cursor is ignored. A category that is not among the first 100 SKUs has no link. The same list feeds the footer. | `pages/ProductDetailPage.tsx` (`taxonomyQuery`); `customer-api.ts` `listProducts` |
| G12 | Availability for the chosen pharmacy only (Decision 10). | `listAvailability()` sends no `siteId` or `productId`, so the whole table loads on each visit and is filtered in the browser. The route accepts both (`catalog-routes.ts`, `/availability`). | `pages/ProductDetailPage.tsx` (`availabilityQuery`); `customer-api.ts` `listAvailability` |
| G13 | A 401 ends the session visibly and returns the shopper here after sign-in (Decision 16, D6). | A 401 that survives the identity retry opens the app-wide session dialog over this page, with "Phiên đã hết hạn. Vui lòng đăng nhập lại." and the sign-in form. The notice wording differs, the sign-in is a dialog rather than a link, and the add notice still shows the server's English title "Authentication required". | `customer-api.ts` `request`; `components/account/SessionEndedDialog.tsx`; `hooks/useAddToCart.ts` |
| G14 | One status vocabulary: "Hết hàng" when out, "Đang cập nhật tồn kho" when unknown, "Không tải được tồn kho" on error (US6). | The card says "Tạm hết hàng" while the header says "Hết hàng"; an availability failure shows "Đang cập nhật tồn kho" with a generic alert. | `pages/ProductDetailPage.tsx` (stock card, badge) |
| G15 | Chat card for a prescription-only product: badge, link, no price (Decision 14, D8). | The card shows the price for every product, prescription-only included. The [user guide](../user-guide.md#shopping-assistant) (Shopping assistant) and the [Prescription intake](../user-guide.md#prescription-intake) section (line about "Liên hệ báo giá") say the same as the code; D8 wins, so code and guide change. | `components/storefront/ChatbotWidget.tsx` (product card); `docs/user-guide.md` |
| G16 | Notes are customer-facing text, and the staff field says so (Decision 15). | Staff-web labels the field "Notes" with no audience; customers see whatever is entered. Staff catalog spec must be aligned. | `apps/staff-web/src/sections/catalog/product-drawer.tsx` (notes field) |
</content>
