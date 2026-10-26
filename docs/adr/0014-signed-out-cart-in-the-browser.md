# 0014. Keep the signed-out cart in the browser

Status: Accepted

Date: 2026-10-26

## Context

`sales-service` stored a cart for a shopper who was not signed in, keyed by the `pharmacy_guest_cart` cookie, in the first version of its schema (`guest_token_digest`, commit `c494340`). The repository does not record why the cart had to live on the server. Placing an order needs a signed-in customer ([BR-ORD-001](../business-rules.md)), and a cookie-bound server cart does not follow a shopper to another device, so it only held items until sign-in.

The server cart cost more than it gave:

- a bearer cookie and a public `/api/carts*` route to protect ([design 0003](../design/0003-harden-guest-cart-cookie-and-trusted-headers.md))
- a read that created a row: every page load called `GET /api/carts` twice before the session was known, and each call created a guest cart. The development database held 37 guest carts, 36 of them empty, and nothing deleted them
- a required `COOKIE_SECURE` setting in `sales-service` that existed only for that cookie

The decision is in [design 0005](../design/0005-client-only-guest-cart.md).

## Decision

- A signed-out shopper's cart lives in the browser, in `localStorage` under `pharmacy.guest-cart.v1`, holding only product and unit ids, quantities and ticks. Prices, stock and fees stay the server's ([ADR 0004](0004-server-authoritative-pricing-stock-and-fees.md)).
- `sales-service` stores carts of signed-in customers only. It sets no guest cookie. Every `/api/carts*` route needs a verified customer context, at the service, at the AWS authorizer and in the ops-console route table.
- On sign-in, customer-web sends the local lines to `POST /api/carts/merge` in the request body. The server sums quantities of lines that match an account line, keeps the account line's tick, and adds the other lines with the tick they were sent with. The browser clears its copy only after the server accepts it.
- `COOKIE_SECURE` is required by `identity-service` only.

## Consequences

- A signed-out cart exists only in one browser. Clearing site data empties it.
- A visitor who never signs in costs the server nothing, and a page load creates no cart row.
- The guest-cart exposures in design 0003 (a), (b) and the guest part of (d) no longer exist. The actor-header stripping and the `anonymous` actor stay.
- The browser cart is user-editable. That only changes the shopper's own cart: the merge request is bounded by its schema and 200 lines, and an order resolves and prices its lines again.
- If a merge response is lost after the server committed, the next load sends the same lines again and duplicates are summed twice ([BR-GAP-007](../business-rules.md)).
- This supersedes the guest cart bullets of [ADR 0005](0005-opaque-sessions-and-csrf.md).

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-CART-001, BR-CART-003, BR-CART-005, BR-GAP-007.
