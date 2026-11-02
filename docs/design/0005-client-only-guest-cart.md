# 0005. Keep the signed-out cart in the browser only

- **Status:** Implemented
- **Author:** TBD (unclaimed)
- **Date:** 2026-10-26

## Summary

A shopper who is not signed in keeps their cart in the browser (`localStorage`), and `sales-service` stores only the carts of signed-in customers. The `pharmacy_guest_cart` cookie, the guest rows in `carts`, and the public `/api/carts*` routes go away. On sign-in, customer-web sends the local lines once to `POST /api/carts/merge`, and clears them after the server accepts them. The change touches `customer-web`, `sales-service` (routes, repository, migration, environment), `ops-console-service` (route table), tests, smoke tooling and the documents listed under Rollout. The owner chose this direction on 2026-10-26 and decided that only the development environment matters for it, so it ships as one clean cutover.

## Motivation

Evidence from code and the local database read on 2026-10-26.

- **No recorded reason for a server guest cart.** `guest_token_digest` is in the first `sales-service` migration (`0000_stormy_tyger_tiger.sql`, commit `c494340`). [architecture.md](../architecture.md) states "Guest and customer carts" as a fact. [ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md) and [design 0003](0003-harden-guest-cart-cookie-and-trusted-headers.md) describe how to protect the cookie, and design 0003 lists "replacing the bearer guest token with a server-side session" as a non-goal. Nothing says why a guest cart must live on the server.
- **A guest cart is only a holding place.** Placing an order needs a signed-in customer ([BR-ORD-001](../business-rules.md)). The server cart is bound to one browser through its cookie, so it does not follow a shopper to another device either.
- **A read creates rows.** On every page load customer-web calls `GET /api/carts` twice, concurrently, before the session is known (`SiteHeader.tsx` and the checkout bootstrap in `OrdersHubPage.tsx`). With no cookie, each call creates a guest cart (`getOrCreateCart`, `sales-routes.ts` `router.get("/carts")`). A trace of a signed-in reload showed two guest-cart responses before `POST /api/carts/merge` returned the real cart. The development database held 37 guest carts, 36 of them empty, and 2 account carts. Nothing deletes a guest cart except the merge, and the cookie lives 30 days.
- **It carries a security surface that exists only for guests.** Design 0003 (a) and (b): a script-readable-then-`HttpOnly` bearer cookie, and a public `/api/carts*` route that once honored a client's `X-Actor-Id`. `/api/carts*` is public in two places: `sales-service/src/main.ts` (`isPublic`) and the ops-console route table.
- **A required variable exists for it.** `COOKIE_SECURE` is required by `sales-service` only for the guest cookie (`main.ts`: "Secure on the guest cart cookie follows it").

## Goals

- A signed-out shopper can add, change, remove and tick cart lines, and keep them across reloads and browser restarts in the same browser, with no request to `sales-service`.
- Signing in moves those lines into the account cart once, keeping each line's tick (BR-CART-001) and summing quantities of duplicates.
- `sales-service` stores no guest data and sets no cookie. Every `/api/carts*` route needs a signed-in customer.
- Opening a page creates no cart row for a signed-out visitor.
- Server prices, stock and fees stay the server's ([ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md)): the local cart holds only ids, quantities and ticks.

## Non-goals

- A signed-out cart that follows the shopper to another browser or device.
- Changing the signed-in cart, its tick behavior (BR-CART-003) or ordering from selected lines ([design 0004](0004-order-from-selected-cart-lines.md)).
- Letting a signed-out shopper place an order.
- Merging a guest cart into a cart on the server for staff or counter sales.

## Proposed design

### Browser store

New module `apps/customer-web/src/storefront/guest-cart.ts`.

- Key `pharmacy.guest-cart.v1`, value `{ version: 1, lines: [{ id, productId, productUnitId, quantity, selected }] }`. `id` is a client-made UUID so rows keep the shape of the server `CartLine` and the components do not change. It is made with `crypto.getRandomValues`, which works on plain-HTTP named URLs (`crypto.randomUUID` needs a secure context).
- Read through a zod schema (`zod` is already a `customer-web` dependency). A value that fails the schema, or a different `version`, is treated as an empty cart and rewritten on the next change. At most 200 lines, the same limit as the merge request.
- Reads and writes are wrapped. If `localStorage` is unavailable or full (private mode, quota), the store keeps the cart in memory for the tab and the page stays usable.
- Other tabs: a `storage` event invalidates the cart query, registered through `useMountEffect` (AGENTS: no direct `useEffect`).

### customer-web cart functions

`customer-api.ts` keeps the names `getCart`, `addCartLine`, `updateCartLine`, `removeCartLines`, `setCartSelection`, so `useAddToCart`, `OrdersHubPage`, `CartItems` and the header are unchanged. Each one waits for the session to resolve, then goes to the server when signed in and to the browser store when not.

- Waiting for the session reuses the in-flight `resolveCustomerSession` promise, so the header no longer calls the server before it knows who the shopper is. A signed-out shopper makes no `/api/carts` request at all.
- `getCart` for a signed-in shopper first sends any local lines to the merge route, clears the store on success, then reads the account cart. This replaces `mergeGuestCart` in `CustomerAuthForm.tsx` and the merge in the `OrdersHubPage` bootstrap. A failed merge leaves the local lines in place and the next load retries it.
- On sign-out the cart query is reset; the browser store is empty because the merge cleared it.

### Contracts

- `POST /api/carts/merge` takes `{ "lines": [{ "productId": uuid, "productUnitId": uuid, "quantity": number > 0, "selected": boolean }] }`, 1 to 200 lines, and answers the account cart. No cookie is read or set. Lines for the same product and unit in the request are summed first. For a product and unit already in the account cart the quantities are summed and the account line keeps its tick; any other line is added with the tick it was sent with (BR-CART-001). Line ids are always made by the server.
- `GET /api/carts`, `POST /api/carts/lines`, `PATCH /api/carts/lines/:id`, `PATCH /api/carts/selection` and `DELETE /api/carts` keep their bodies and answers. They answer `401 trusted_request_required` without a verified customer context (today they accept a cookie-only caller).
- No change to `/api/orders*` or `/api/delivery*`.
- Routing is unchanged ([routes.conf](../../deploy/local/gateway/routes.conf), `main.tf` path rules): only the access level of `/api/carts*` changes, in `sales-service/src/main.ts` `isPublic` and `ops-console-service` `route-table.ts` (the note "Carts work for guests" and its Vietnamese text in `staff-web/src/i18n/governance.ts`).

### Data model

Migration `0013` in `sales-service`: delete the guest carts (`customer_id IS NULL`) and their lines, drop `carts_guest_token_unique` and `guest_token_digest`, and make `customer_id` `NOT NULL`. `schema.ts`, the repository (`getCart`, `getOrCreateCart`, `addCartLine`, `clearCart`, `updateCartLine`, `setCartSelection` and `findCart` lose their `guestToken` parameter and `assertCartIdentity`; `mergeGuestCart` becomes `mergeLocalCart(customerId, lines)`) and the routes follow. Whether `cart_lines` rows go by cascade or by an explicit delete is checked when the migration is written.

### Environment

`COOKIE_SECURE` stops being required by `sales-service`. Remove it from `sales-service` bootstrap, its Compose environment and `.env.dev`, and the runbook text that names `sales-service`. `identity-service` keeps it (the OAuth state cookie).

### Events

None. Carts publish no integration event.

### Security
<!-- anchor: security-and-csrf -->

- No guest bearer cookie remains. The cart-side exposure in design 0003 (a), (b) and the guest part of (d) disappears because no cart route is public.
- The merge route takes ids, quantities and ticks from the browser; it does not take prices, stock or identity. Like `POST /api/carts/lines` today, it does not check that a product exists. Ordering resolves and prices the lines again (BR-ORD-002).
- A shopper can edit `localStorage`, which only changes their own cart. The merge request is bounded by the zod schema and the 200-line limit.
- Browser mutations authenticate with the bearer token only.

### Observability

No new metric. Guest cart changes no longer appear as `sales-service` requests, so the existing cart route rate drops to signed-in traffic only.

## Alternatives considered

- **Keep the server guest cart, create it only when a line is added, and sweep old ones.** Smallest change, and the signed-out cart survives clearing site data on a shared device. It keeps the bearer cookie, the public route, the guest column and `COOKIE_SECURE`, and adds a sweep to maintain. Rejected by the owner for this reason.
- **`sessionStorage`.** A signed-out basket would disappear when the tab closes. Rejected.
- **A cart in a cookie.** The 4 KB limit and sending it on every request, static files included. Rejected.
- **IndexedDB.** More code and an async API for at most 200 small rows. Rejected.
- **A signed, stateless cart token from the server.** Needs a round trip and a signing key for every change, to protect data the shopper may change anyway. Rejected.

## Rollout and migration

This is a development environment and dev data is disposable ([AGENTS.md](../../AGENTS.md)), so there is no rollout order, no compatibility code and no data to carry over. One change ships `customer-web`, `sales-service` and the ops-console route table together. `pnpm run stack:up` rebuilds the images and `pnpm run db:migrate` applies `0013`, which deletes the guest carts and drops the guest column. Compose does not run migrations.

If this ever ships to an environment with live shoppers, a rolling update needs a different order (web first, then `sales-service`, then the migration), because an old `sales-service` instance selects `guest_token_digest` and fails once the column is dropped. That case is not designed here.

Documents updated in the same change: [ADR 0014](../adr/0014-signed-out-cart-in-the-browser.md) (new; it supersedes the guest cart bullets of [ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md)), design 0003 (note the part replaced), [architecture.md](../architecture.md) and [README.md](../../README.md), [api-guide.md](../api-guide.md) (carts, the merge body), [runbook.md](../runbook.md) (`COOKIE_SECURE`), [business-rules.md](../business-rules.md) (BR-CART-001, BR-CART-003, BR-CART-005, BR-GAP-007), the [Orders page spec](../product/customer-orders-page.md), [user-guide.md](../user-guide.md), [CHANGELOG.md](../../CHANGELOG.md), and the two skill feature files `cart-and-checkout.md` and `customer-sign-in-account.md`.

## Testing

- **customer-web (Vitest, store):** add, change, remove and tick lines; a duplicate product and unit sums; a corrupt or old-version value reads as an empty cart; an unavailable `localStorage` keeps working in memory.
- **customer-web (Vitest, behavior):** with a signed-out session, cart operations make no `/api/carts` request; with a signed-in session they do; before the session is known they wait. The local lines are sent once on sign-in, cleared on success and kept on failure.
- **sales-service (PGlite, real migrations, as in `sales-repository-cart-selection.test.ts`):** `mergeLocalCart` sums duplicates, keeps the account line's tick, adds new lines with the sent tick, and touches only the caller's cart. A test applies `0013` to a database holding guest and customer carts and checks that only the customer carts remain. If the migrator cannot stop before `0013`, this is checked by a smoke run on a seeded database instead.
- **sales-service (routes):** `/carts*` with no verified context answers `401`; the merge body is rejected when `lines` is missing, empty or over 200; no response sets `pharmacy_guest_cart`.
- **Smoke (container mode, 1920x1080):** signed out, add two products and tick one; reload and confirm the cart and tick survive and the network log has no `/api/carts` request; sign in and confirm the server cart holds both lines with the same tick, the browser key is gone, and the `carts` table has gained no row for the visit. Update `tools/edge-identity-smoke.mjs`: replace the guest-cookie checks with "`GET /api/carts` with no context answers 401 and sets no cookie".

## Decisions taken

- Existing guest carts are deleted by the migration. Dev data is disposable (owner, 2026-10-26).
- A change in one tab reaches the other tabs through the `storage` event.

## Known limitation

If the merge response is lost after the server committed, the local lines stay, the next load sends them again and the quantities of duplicate lines are summed twice (recorded as BR-GAP-007). An idempotency key and its table, or merging duplicates by the larger quantity (idempotent, but it changes BR-CART-001 "quantities are summed"), would close it. Neither is built.

## Related

- [ADR 0004](../adr/0004-server-authoritative-pricing-stock-and-fees.md): unchanged; the browser cart holds no prices.
- [ADR 0005](../adr/0005-jwt-only-authentication-no-sessions-or-csrf.md) and [design 0003](0003-harden-guest-cart-cookie-and-trusted-headers.md): their guest cart parts are replaced if this is accepted.
- [Design 0004](0004-order-from-selected-cart-lines.md): concerns the signed-in cart only and is not affected.
- [Product spec: Orders page](../product/customer-orders-page.md): US1 and the signed-out state.
