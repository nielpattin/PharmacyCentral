# 0004. Server-authoritative pricing, stock and fees

Status: Accepted

Date: 2026-09-10

## Context

The browser shows prices, a delivery fee and stock, then sends an order or an invoice. Any client can send any value, so
the server must not trust the browser for money, stock or identity. The rule is in [AGENTS.md](../../AGENTS.md) (staged,
not yet committed) and [architecture.md](../architecture.md#data-ownership). The first sales-service commit, `c494340`
(2026-09-10), already priced orders on the server; the reason is not recorded in the repository.

Two later commits closed gaps in the invoice path. `0c8161c` (2026-10-21) stopped payment-service from invoicing a
shopper from the request, which let a shopper pay any amount for their own order. `24118aa` (2026-10-26) added the
delivery fee to shopper invoices; its message reports an 18.820đ delivery order invoiced at 5.820đ.

## Decision

- **Order prices.** `POST /orders` (`apps/sales-service/src/modules/sales-routes.ts`) accepts only product, unit and quantity
  per line; `createOrderRequestSchema` has no price field. `resolveOrderLines` reads each product and its active price from
  catalog-service and stores `unitPriceSnapshot`. No active price returns 409 `product_unpriced`.
- **Delivery fee.** `apps/sales-service/src/modules/delivery/domain/delivery-calculator.ts` computes the fee from the selected
  store and the destination, using a route from OpenRouteService. Four settings are read at startup with no defaults:
  `DELIVERY_FREE_DISTANCE_METERS`, `DELIVERY_FEE_BASE`, `DELIVERY_FEE_PER_KILOMETER` and `DELIVERY_MAX_DISTANCE_METERS`.
  A route at or beyond the maximum returns 422 `delivery_out_of_range`. `/delivery/calculate` is a quote only.
- **Stock.** Sales sends the order's quantities to inventory-service, which holds them. A shortage returns 409
  `insufficient_stock`. The browser supplies no stock figure.
- **Shopper invoices.** `priceInvoiceRequest` (`apps/payment-service/src/modules/invoice-pricing.ts`) builds the lines from
  the shopper's own order, read through sales-service. The order must be Pending and unpaid, and the request's unit prices
  are ignored. Since `24118aa`, a "Phí giao hàng" line carries the order's delivery fee.
- **Payment amount.** A provider transaction whose amount differs from the invoice is recorded as a failed attempt with
  reason `amount_mismatch` (`apps/payment-service/src/modules/payment-repository.ts`).
- **Identity.** Sales and payment drop `x-actor-id` unless the signed internal context verified it
  (`middleware/trusted-request.ts`).
- **Copy.** Checkout tells the shopper: "Giá và phí giao hàng được hệ thống tính lại khi bạn xác nhận đặt hàng"
  (prices and delivery fee are recalculated when you confirm), in `apps/customer-web/src/components/checkout/OrderSummary.tsx`.

## Consequences

- The fee the shopper sees before confirming is a preview; the order stores the server's value.
- Observed cost: each line makes two catalog calls with a 2 s timeout, and a delivery order makes a route call. Its result is
  cached for 300 s, in Redis when configured and in memory otherwise (`apps/sales-service/src/main.ts`).
- Without `OPENROUTESERVICE_API_KEY` there is no route provider, so a delivery order returns 503 `delivery_unavailable`. The
  service does not fall back to another fee.
- Staff invoices are the exception: `priceInvoiceRequest` returns a staff request unchanged, so counter sales use the lines
  and prices staff enter. The rule covers shoppers only.
- Before `24118aa`, shopper invoices for delivery orders left out the delivery fee, so the QR amount was short.

## Alternatives considered

- Invoice a shopper from the request's lines, as payment-service did before `0c8161c`. A shopper could then invoice their own
  order at any amount.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-PRICE-008 (active price), BR-ORD-001 to BR-ORD-003 (order prices and totals), BR-DLV-005 (delivery fee formula), BR-PAY-008 (shopper invoice from order lines).
