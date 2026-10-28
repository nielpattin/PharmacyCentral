# 0004. Order from the selected cart lines on the server

- **Status:** Implemented
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

Cart lines now carry a server-kept `selected` flag, and customer-web orders only the ticked lines (BR-CART-001 to BR-CART-004). Today that rule is held by the browser alone: `POST /api/orders` takes whatever `lines` the client sends, and customer-web removes the ordered lines with a second call afterwards. This design lets the server build the order from the caller's selected cart lines and remove them once the stock is held. It affects `sales-service` (contract, route) and `customer-web`. The existing `lines` request keeps working unchanged for every other caller.

## Motivation

Evidence from code read on 2026-10-26.

- `createOrderRequestSchema` (`apps/sales-service/src/contracts/sales.ts:107`) requires `lines`, and `POST /orders` (`apps/sales-service/src/modules/sales-routes.ts:296`) prices and orders exactly those lines. It never reads the cart, so a client that sends a line the shopper did not tick still gets an order. This is recorded as `BR-GAP-006` in [business-rules.md](../business-rules.md).
- customer-web builds `lines` from `cart.lines.filter(line => line.selected)` and then calls `DELETE /api/carts` with the ordered ids (`apps/customer-web/src/pages/OrdersHubPage.tsx`, `placeOrder`). Two requests carry one decision. If the order succeeds and the removal fails, the order exists and the lines stay in the cart. customer-web handles that case with a message, "đã được tạo nhưng chưa hoàn tất thanh toán".
- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md) already makes the server authoritative for prices, stock and fees. What gets ordered is the one input of an order the server still takes on trust from the browser.
- Callers of `POST /orders` that do not use a cart and send `lines` directly: `tools/k6/scenarios/checkout.js`, `tools/k6/scenarios/oversell.js`, `tools/chaos/lib/shop.mjs`, `tools/seed-demo.mjs` and `.agents/skills/verify-pharmacy-central/scripts/order-stock-proof.mjs`. Any change that makes `lines` illegal for them breaks load, chaos and proof tooling.

## Goals

- A shopper who orders from the cart orders exactly their ticked lines, decided by the server from the cart, not by the request.
- Ordering from the cart needs one request. The ordered lines leave the cart on the server, after the stock hold succeeds.
- A request that names `lines` behaves exactly as it does today, so no existing client, script or contract test changes.
- With no ticked line, the server refuses with a stable error code.

## Non-goals

- Making `lines` illegal for customers. That would break the five callers above and is left as an open question.
- Reserving cart lines against a concurrent second order (see Open questions).
- Staff counter sales, which do not use the cart.
- Changing how prices, stock or delivery fees are computed (ADR 0004).

## Proposed design

### Contracts

`POST /api/orders` accepts exactly one of two shapes. The existing fields (`selectedStoreId`, `fulfillmentType`, `paymentMethod`, `delivery`) are unchanged in both.

| Shape | Body | Lines ordered |
| --- | --- | --- |
| Existing | `lines: [{ productId, productUnitId, quantity }]` | The request's lines, as today |
| From the cart | `fromCart: true`, no `lines` | The caller's cart lines with `selected = true`, quantities read from the cart |

- Sending both `lines` and `fromCart`, or neither, answers `400 invalid_request`.
- `fromCart` with no ticked line answers `409` with code `cart_selection_empty`.
- `fromCart` for a caller with no cart answers the same `409`.
- The response is the order, as today. `GET /api/carts` after a successful `fromCart` order no longer lists the ordered lines. The lines that were not ticked stay, unticked.
- `docs/api-guide.md` documents the second shape and the error. The path routing map does not change.

Flow of the new shape in `POST /orders`: read the caller's cart and take the selected lines; run the existing `resolveOrderLines`, delivery calculation, `repository.createOrder` and `orderStock.hold`; only after `hold` returns, delete the lines that were ordered (by id, scoped to the caller's cart, as `clearCart(..., lineIds)` does today). An error before that point leaves the cart as it was.

### Data model

None. `cart_lines.selected` already exists (migration `0012_cart_line_selected`).

### Events

None. The order outbox rows are written by `createOrder` as before.

### Security and CSRF

- The route stays signed-in only (`unauthorized` without an actor). The cart is looked up by the verified customer id, never by a request field.
- Browser mutations keep the CSRF rules. No new secret.
- Because the lines come from the cart, a client can no longer order a line the shopper did not tick by naming it in the request, when it uses the new shape.

### Observability

None. A `fromCart` order carries the same trace as any order. A span attribute naming the shape was considered and not built, because nothing reads it yet.

## Alternatives considered

- **Verify `lines` against the selected cart lines (reject on mismatch) for customers.** Makes the rule hold for every customer order, but turns the five direct callers into cart users: each would have to add and tick lines first, and the load test shape changes. It also changes behavior for existing clients, which AGENTS.md rules out unless approved.
- **Keep it as is and document `BR-GAP-006`.** No risk, but the rule stays a browser convention and the two-request window stays. This is the current state.
- **Remove the ordered lines inside `createOrder`'s transaction.** Atomic with the order row, but `orderStock.hold` runs after the commit and can fail with `insufficient_stock`. The shopper would lose cart lines for an order that did not go through. Removing after the hold avoids that.
- **A separate `POST /api/carts/checkout`.** Keeps `/orders` untouched but duplicates the order pipeline in another route and splits the order contract in two places.

## Rollout and migration

1. `sales-service` accepts `fromCart` and the new error. Nothing sends it yet, so this is safe on its own.
2. `customer-web` switches `placeOrder` to `fromCart: true` and drops its `DELETE /api/carts` call and the "order created but cart not cleared" branch.
3. Update `BR-CART-002` and `BR-CART-004`, close or narrow `BR-GAP-006` (direct `lines` callers still bypass the cart on purpose), and update the API guide, user guide and changelog.

No migration and no data backfill. Rollback is reverting step 2; step 1 is inert without a caller. This is a development environment, so both steps shipped together. An optional `lineIds` list that was added to `DELETE /api/carts` earlier the same day had no caller left once the server removes the ordered lines, so it was removed and `DELETE /api/carts` empties the cart as before.

## Testing

- **Repository, real SQL** (PGlite with the real migrations, as in `sales-repository-cart-selection.test.ts`): the selected lines are read for the caller's cart only, and removal after an order leaves the unticked lines.
- **Routes** (`sales-routes.test.ts`): both shapes together and neither answer 400; `fromCart` with nothing ticked answers 409 `cart_selection_empty`; an `insufficient_stock` failure leaves the cart untouched; the existing `lines` request is unchanged.
- **Contracts** (`contracts.test.ts`): the schema accepts each shape and rejects a mix.
- **Browser**: tick two of three lines, order, and confirm one request and a cart with the one unticked line left, as in the smoke run for BR-CART-002.
- `tools/k6` and `tools/chaos` need no change; run `order-stock-proof.mjs` to confirm the `lines` shape is untouched.

## Decisions taken

- A ticked line without an active price is left to the existing `product_unpriced` 409; `cart_selection_empty` means no line is ticked.
- If removing the ordered lines fails after the stock is held, the error reaches the caller as any other server error and the order exists. Not handled further.

## Open questions

- Should customers lose the `lines` shape later, once k6, chaos, the import script and the proof helper are moved to carts? Owner: repository owner. This design leaves it open (BR-GAP-006).
- Two concurrent `fromCart` orders from the same cart (two tabs) can both read the same ticked lines before either removes them (BR-GAP-008). Is a row lock on the cart worth the cost? Owner: sales-service owner.

## Related ADRs

- [0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): this design extends "the server is authoritative" from prices, stock and fees to which lines are ordered. If accepted, it is a candidate for an amendment to 0004 or a new ADR, written after the review, as [docs/adr/README.md](../adr/README.md) asks.
- [0005](../adr/0005-opaque-sessions-and-csrf.md): the guest cart cookie and merge. This design reads only a signed-in customer's cart, so [design 0005](0005-client-only-guest-cart.md) (Implemented), which moves the signed-out cart into the browser, does not affect it.
- [Product spec: Orders page](../product/customer-orders-page.md): what the page must do (US1). This design changes how the server decides which lines are ordered, not what the page contains.
