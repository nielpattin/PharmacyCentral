# Cart and checkout

A signed-in shopper adds a product to the cart, reviews it on the checkout page, chooses a payment method, places the order, and finds the order in their order list. Prices and stock come from the services, never from the browser. The flow is AI-gated only through catalog-service, so run it only with the user's explicit approval for that run.

## Sub-features

- `cart-add` adds a product from its detail page with the button `Thêm vào giỏ hàng`.
- `cart-merge-on-sign-in` sends the signed-out cart lines kept in the browser to the account cart at sign-in.
- `checkout-review` shows the cart lines on `/don-hang` under the heading `Đặt hàng & thanh toán`.
- `checkout-place-order` submits with `Đặt hàng` and shows the order status.
- `order-list` shows the new order in `/don-hang-cua-toi`.

## How to get to it (user POV)

- Open a product page from search and choose `Thêm vào giỏ hàng`.
- Choose `Giỏ hàng` in the header. It links to `/don-hang`.
- Open `/don-hang-cua-toi` from the header's order link after the order is placed.

## Driving it with the browser global

Preconditions:

- Mode chosen with the user. Dev mode: `node .agents/skills/verify-pharmacy-central/scripts/launch.mjs --need identity-service,catalog-service,inventory-service,sales-service,payment-service,customer-web --ai-approved`. The `--ai-approved` flag covers the catalog startup sweep. Container mode: the user's approval is recorded, `pnpm run local:up` is healthy, and no launch runs.
- `node .agents/skills/verify-pharmacy-central/scripts/doctor.mjs --mode <dev|container> --need identity-service,catalog-service,inventory-service,sales-service,payment-service,customer-web --role customer` reports `RESULT ready`.
- The signed-in customer state `~/.omp/browser-profiles/customer.json` exists and parses. If it is missing or stale, sign in as in customer-sign-in-account.md and save it with `tab.saveState`. Open the tab with `browser.open({ name, url, viewport: { width: 1920, height: 1080 }, app: { tern: false, relay: false } })`, then `tab.loadState` before `tab.goto`. Confirm `GET /api/auth/me` returns `khachhang@pharmacycentral.vn` before the first step.
- Stock exists. Opening balances come from `POST /api/inventory/imports/opening-balances`, or `pnpm run seed:demo`.
- The customer has a delivery address. Address search and route calculation call the VietMap service with `VIETMAP_API_KEY`. That is an external map API, not an AI provider, and it needs network access.
- Payment: the default method is `sepay_qr`, which shows a bank QR code and waits for SePay. Use `cash_on_delivery` for the proof, so no external payment call happens.

Steps:

- **Signed-out cart stays in the browser.** On a clean tab with no saved state, open `http://customer.pharmacy.localhost/san-pham/<id>` for `THU-0001` (see storefront-search.md) and click `role/button[name="Thêm vào giỏ hàng"]`. Repeat for a second product, then tick one line on `/don-hang`. Result: the header cart count goes up by the quantity, and the lines are in the browser under `pharmacy.guest-cart.v1`. Side effect: the network log has no `/api/carts` request for the visit, and sales-service gains no `carts` row.
- **Reload keeps the signed-out cart.** Run `tab.reload()` on `/don-hang`. Result: both lines and the tick on the chosen line survive, and the network log still has no `/api/carts` request.
- **Merge on sign-in.** Sign in on the same tab as customer-sign-in-account.md. Result: the browser key `pharmacy.guest-cart.v1` is gone, and `GET /api/carts` answers `200` with both lines, the ticked line still ticked. Side effect: the account's `carts` row holds both lines, each with the tick it had in the browser.
- **Add to cart (signed in).** Open `http://customer.pharmacy.localhost/san-pham/<id>` for `THU-0001` (see storefront-search.md). Click `role/button[name="Thêm vào giỏ hàng"]`. Result: the button reads `Đang thêm...` while the request runs, then the header cart count goes up by the quantity. Side effect: `GET /api/carts` through the gateway returns a line for the product.
- **Review.** Open `/don-hang`. Result: the h1 `Đặt hàng & thanh toán` appears and the cart lines show the product name.
- **Choose cash on delivery.** Select the option `Thanh toán khi nhận hàng`. Result: the payment choice is cash on delivery. The QR code does not appear.
- **Place the order.** Click `role/button[name="Đặt hàng"]`. Result: the page moves to the order state, and the store holds the stock for the order (a store without enough answers the alert `Cửa hàng này không còn đủ hàng cho đơn của bạn.`). The order status reads `Chờ xác nhận` (Pending) on the order list. (Mapped, not yet re-driven under the new rules.)
- **Second view.** Run the in-page fetch `/api/orders` with `credentials: 'include'`. Result: status `200` and an array that includes the new order id. Side effect: the sales-service row exists with the same total and status. (Mapped, not yet re-driven.)
- **Pay it.** A cash-on-delivery order stays `Chờ xác nhận` until staff marks the invoice paid with `POST /api/payments/<invoiceId>/cash-paid` (`payment-routes.ts:167`). Find the invoice id in `GET /api/payments/invoices`. Result: within a few seconds the order list reads `Đã xác nhận` and `GET /api/orders/<id>` shows `paymentStatus: Paid`. The order does not change through an HTTP call. payment-service writes `payment.invoice.paid.v1` to its outbox, the outbox publisher sends it to the exchange `pharmacy.events`, and sales-service consumes it from the queue `sales.payment-events.v2` (`payment-event-consumer.ts`). `scripts/messaging-proof.mjs` proves that event path without the browser, see event-delivery.md. (Mapped, not yet re-driven through the browser.)
- **Close.** Run `tab.clearCookies()` and `tab.close()` after the drive.

## Gotchas

- Checkout defaults to the SePay QR method. Choosing it starts a real invoice in payment-service and waits for a bank webhook. Use cash on delivery in proof runs.
- Cash on delivery does create a payment-service invoice: `CheckoutPage.tsx` always calls `createPaymentInvoice`, and `payment-repository.ts:44-80` stores it with method `cash_on_delivery` and emits `payment.invoice.created.v1`. (Read from source, not yet observed live.)
- Creating the invoice throws without the `PHARMACY_PAYMENT_SEPAY_*` settings, even for cash on delivery, and the order already exists when it does. Doctor does not check them.
- Delivery fees come from `POST /api/delivery/calculate`. A VietMap outage blocks the address step and is an external failure, not a checkout bug.
- The header cart badge reads `0` when sales-service is down. Check the cart through `GET /api/carts` on a signed-in session before reporting an empty cart. A signed-out cart is read from the browser, not from sales-service.
- Re-running the order flow adds another order. Keep one order per run and record its id in the evidence.
