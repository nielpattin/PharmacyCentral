# 0015. The server picks the cart lines of an order

Status: Accepted

Date: 2026-10-26

## Context

A shopper ticks the cart lines they want to buy now (BR-CART-001 to BR-CART-003), and the ticks are kept on the server. `POST /api/orders` still took the lines from the request body, so which lines were ordered was the one input of an order that the server took on trust from the browser, next to the prices, stock and fees that [ADR 0004](0004-server-authoritative-pricing-stock-and-fees.md) already takes from the server. customer-web also needed a second request to remove the ordered lines from the cart, which could fail after the order existed. The decision is in [design 0004](../design/0004-order-from-selected-cart-lines.md).

## Decision

- `POST /api/orders` accepts exactly one of `lines` or `fromCart: true`. With `fromCart` the server reads the caller's ticked cart lines, takes the quantities from the cart, and removes those lines once the stock is held.
- No ticked line answers `409 cart_selection_empty`. A refused order (stock, price, delivery range) leaves the cart as it was.
- The `lines` shape is unchanged, because k6, chaos, the sample import and the stock proof order without a cart.

## Consequences

- customer-web sends `fromCart: true` and makes no second request. The rule "only ticked lines are ordered" no longer depends on the browser.
- A client that sends `lines` can still order lines that are not ticked (BR-GAP-006).
- Two orders placed at once from the same cart can take the same lines, because the cart is not locked (BR-GAP-008).
- If removing the lines fails after the stock is held, the order exists and the caller sees a server error.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-CART-002, BR-CART-004, BR-GAP-006, BR-GAP-008.
