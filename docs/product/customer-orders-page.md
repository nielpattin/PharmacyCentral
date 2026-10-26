# Orders page

- **Status:** Current
- **App and route:** customer-web, `/don-hang` (tabs **Đặt hàng** and **Đơn của tôi**, `/don-hang?tab=don-cua-toi`)
- **Owner:** @nielpattin
- **Last reviewed:** 2026-10-26

Tags: `[owner]` stated by the owner, `[observed]` read from the code on 2026-10-26 with no recorded reason, `[question]` unknown. See [README](README.md).

## Purpose

- `[owner]` A customer can order only some of the products in their cart, and keep the others for later. Before this, the page ordered the whole cart. (Owner, 2026-10-26.)
- `[observed]` The page is where a customer turns a cart into an order and then follows it: review the cart, choose how to receive and pay, place the order, pay, and track it.
- `[question]` Why it is one page with two tabs, and why the order form and the order list share it. See Open questions.

## Users and entry points

- `[observed]` Customers. Browsing and adding to the cart work without an account; placing an order needs a signed-in customer.
- `[owner]` A signed-out customer's cart is kept in the browser only; the server stores carts of signed-in customers ([design 0005](../design/0005-client-only-guest-cart.md), [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md)). Signing in moves the browser cart into the account.
- `[observed]` Entry points: the cart link ("Giỏ hàng") and "Đơn hàng của tôi" in the site header and footer.
- `[observed]` The tab is in the URL (`?tab=don-cua-toi`). Switching tabs hides the form instead of unmounting it, so the choices on the order form and the payment panel of a placed order survive a tab switch.

## User stories and acceptance criteria

### US1. As a customer, I choose which products in my cart to order now, so that I can keep the rest for a later order

- Source: `[owner]` 2026-10-26. Default unticked and the saved ticks were the owner's choices.
- Accepted when:
  - A product newly added to the cart is unticked.
  - Ticking or unticking a product is saved with the cart, so it is the same after a reload. For a signed-in customer it is also the same on another device; for a signed-out customer it stays in that browser.
  - **Chọn tất cả (x/y)** ticks every product, or unticks every product when all are ticked.
  - The order summary, the subtotal, the total and **Đặt hàng** cover only the ticked products.
  - With no product ticked, **Đặt hàng** is disabled and the page says "Tick ít nhất một sản phẩm trong giỏ để đặt hàng."
  - An unticked product without a price does not block ordering the ticked ones. A ticked product without a price does.
  - **Đặt hàng** orders the products ticked in the customer's cart on the server, not the list the page shows. Only those products leave the cart, and only once the order is accepted. A refused order leaves the cart as it was. The others stay, unticked.
- Rules: BR-CART-001 to BR-CART-005. Known gaps: BR-GAP-006, BR-GAP-007, BR-GAP-008.

### US1a. As a customer, when I press "Mua ngay" on a product page, I land on the order page with that product ready to order

- Source: `[owner]` 2026-10-26.
- Accepted when:
  - "Mua ngay" adds the product to the cart, ticks that line, and opens `/don-hang`.
  - Lines already in the cart keep their ticks. "Thêm vào giỏ hàng" still adds the line unticked.
  - If ticking fails after the product was added, the customer still reaches `/don-hang` with the line in the cart, unticked.
- Rules: BR-CART-001.

### US2. As a customer, I choose to have the order delivered or to collect it at a pharmacy

- Source: `[observed]`
- Accepted when:
  - The two choices are **Giao tận nơi** (the default) and **Nhận tại nhà thuốc**.
  - For delivery, the customer picks a delivery point and gets a fee with **Tính phí giao hàng** before **Đặt hàng** is enabled. Changing the pharmacy, the point or the fulfillment clears the fee.
  - For pickup, the fee is "Không phí" and the page shows the pharmacy to collect from.
- Rules: BR-ORD-003, BR-DLV-001 to BR-DLV-008.

### US3. As a customer, I choose how to pay

- Source: `[observed]`
- Accepted when:
  - The two choices are **Chuyển khoản SePay QR** (the default) and **Thanh toán khi nhận hàng**.
  - After placing the order, the payment panel shows the order number, payment code, amount, status, and for QR the code and transfer description.
- Rules: BR-ORD-002, BR-PAY-008.

### US3a. As a customer, I cannot put a prescription-only product in the cart

- Source: `[owner]` (2026-10-26)
- Accepted when:
  - A product the catalog marks `prescriptionRequired` has no add-to-cart or buy button; the shop shows "Cần đơn thuốc" or a link to **Gửi đơn thuốc**.
  - `POST /api/carts/lines` and `POST /api/orders` for such a product answer `409 prescription_required`; a cart merge drops the line.
  - A signed-out shopper is refused too.
- Rules: BR-ORD-011, BR-CART-001. [ADR 0016](../adr/0016-prescription-only-products-are-not-sold-online.md).

### US4. As a customer, I follow my orders after I place them

- Source: `[observed]`
- Accepted when:
  - The **Đơn của tôi** tab lists the customer's orders, newest first, with the most relevant order featured at the top as the user guide describes.
  - A customer sees only their own orders.
- Rules: BR-ORD-005 to BR-ORD-010.

## Contents and behavior

`[observed]` for all of this section. The reason a section is on the page is not recorded unless stated.

**Đặt hàng tab, in order:**

1. A three-step indicator: **Giỏ thuốc**, **Nhận hàng & thanh toán**, **Hoàn tất**. Step 3 is shown once an order is placed.
2. After an order is placed: the payment panel (US3).
3. **Giỏ thuốc** card: the **Chọn tất cả** control, then one row per cart line with a tick box, photo, name (links to the product page), unit and SKU, unit price, a "Có thể hết hàng" badge when stock may be out, a quantity control, a remove button and the line total. A line without a price shows "Liên hệ báo giá". **Thêm thuốc** in the header opens the picker.
4. **Chọn thuốc & vật tư y tế** card (the picker): a search box and product list with an add button. It is open when the cart is empty and folds away once the cart has lines; **Thêm thuốc** reopens it and **Thu gọn** folds it.
5. Once the cart has a line: **Hình thức nhận hàng & thanh toán** (US2, US3) and the delivery or pickup panel (pharmacy selection, address search, saved addresses, current location, a note for the courier, **Tính phí giao hàng**, **Lưu điểm giao này**, and a map). `[owner]` The page must stay usable when WebGL is unavailable: an unavailable-map message replaces the map instead of crashing the page.
6. A side summary, **Đơn hàng của bạn**: the ticked products with quantity and price, subtotal, delivery fee, total, where the order is received, and **Đặt hàng**. It repeats "Giá và phí giao hàng được hệ thống tính lại khi bạn xác nhận đặt hàng": prices and fees on screen are a preview and the server computes the real ones (ADR 0004).

**Reasons **Đặt hàng** is disabled, in the order the page checks them:** not signed in ("Đăng nhập tài khoản khách hàng để đặt hàng."), empty cart ("Thêm thuốc vào giỏ để đặt hàng."), nothing ticked, no pharmacy chosen ("Chọn nhà thuốc xuất đơn."), delivery without a fee ("Chọn điểm giao và bấm “Tính phí giao hàng” trước khi đặt."), a ticked product without a price.

**Đơn của tôi tab:** the order list described in the [user guide](../user-guide.md#orders).

## States

- `[observed]` Cart loading: skeleton rows in the cart and the summary.
- `[observed]` Cart failed to load: the cart and summary stay empty and an error alert shows. The empty-cart copy never stands in for a failed load.
- `[observed]` Empty cart: only the cart and the picker are shown. The fulfillment, payment and delivery sections are hidden.
- `[observed]` Order created but a later step failed: the page says the order exists and points to the **Đơn của tôi** tab, so the customer does not place it twice.
- `[observed]` Signed out: the page shows the cart from the browser and disables **Đặt hàng** with a sign-in link. No request goes to `sales-service` for the cart. `[question]` Whether a signed-out customer should reach the page at all is not recorded.

## Out of scope

- `[observed]` Ordering a prescription-only product without a price. Such products show "Liên hệ báo giá" and are not orderable online (the intake page offers **Nhờ dược sĩ tư vấn**, see the [user guide](../user-guide.md)).
- `[observed]` Editing an order after it is placed; a customer can only cancel an unpaid order (BR-ORD-008).
- `[observed]` Counter sales. Staff use staff-web.

## Rules and designs

- Business rules: [BR-CART-001 to 004, BR-ORD-001 to 011, BR-DLV-001 to 008, BR-PAY-008](../business-rules.md).
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): prices, stock and fees are the server's.
- [Design 0004](../design/0004-order-from-selected-cart-lines.md) (Implemented): moving "which lines are ordered" to the server.
- [User guide, Cart and checkout](../user-guide.md#cart-and-checkout): how a customer works through it.

## Decisions

Answered from published e-commerce research on 2026-10-26, because the owner asked for the standard answer. Tag `[standard]`: a recommendation from a source, not a recorded decision. The owner accepted these answers on 2026-10-26, and settled the prescription item the same day (US3a, BR-ORD-011, ADR 0016). The answers stay recommendations until the owner replaces them with a recorded reason.

- **One page with two tabs.** `[standard]` Checkout research asks for a linear, predictable flow and an enclosed checkout without distractions ([Baymard](https://baymard.com/blog/checkout-flow-ux-optimization)); it says nothing about where order history lives. Keep it. Low priority. The reason it was built this way is not recorded. Owner.
- **Delivery and QR as defaults.** `[standard]` No source found for the delivery default. For payment, a Ministry of Industry and Trade article (2024; only the search excerpt was read) puts cash on delivery at over 80% of Vietnamese e-commerce orders, with 15% to 20% returned, so a prepaid default lowers return risk. Medicine that has been handed over cannot be put back on the shelf is `[inference]`. Keep the defaults and record this as the reason if the owner agrees. Owner.
- **The picker folds away once the cart has lines.** `[standard]` Consistent with Baymard: ads and cross-sells in the cart or checkout pull the shopper away from finishing, and should stay secondary ([Baymard](https://baymard.com/blog/reduce-cart-abandonment)). Keep it, with **Thêm thuốc** one click away.
- **Signed-out customers.** `[owner]` Ordering needs a signed-in customer (BR-ORD-001); the owner confirmed this on 2026-10-26. Reaching `/don-hang` signed out to review the cart stays allowed. For the record, `[standard]` Baymard finds 19% of US shoppers abandoned an order because they had to create an account, and recommends guest checkout; this shop does not offer guest checkout.
- **A ticked product goes out of stock before the order.** `[standard]` Baymard: never leave the shopper at a dead end; offer alternatives, since 30% abandon when only told "out of stock" ([Baymard](https://baymard.com/research-articles/handling-out-of-stock-products)). Selling an out-of-stock item for later delivery does not fit here, because the server holds real batch stock when the order is placed. Recommended: keep `409 insufficient_stock`, keep the cart and its ticks, name the product that failed, and offer to remove it or to ask a pharmacist for an alternative. The current message is not verified. Owner.

## Gaps against the code (2026-10-26)

| ID | The spec requires | The code does today | Where |
| --- | --- | --- | --- |
| G1 | A refused order for stock keeps the cart and ticks, names the product that failed, and offers to remove it or ask a pharmacist | The cart and its ticks are kept on a refusal (`sales-routes.ts` clears lines only after stock is held). The 409 shows a Vietnamese message (`OrdersHubPage.tsx` `deliveryErrorMessage`) that names no product and offers "Hãy giảm số lượng hoặc chọn cửa hàng khác", not removal or a pharmacist request. | `apps/customer-web/src/pages/OrdersHubPage.tsx`, `apps/sales-service/src/modules/sales-routes.ts` |
