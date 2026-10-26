# 0016. Prescription-only products are not put in the cart or sold online

Status: Accepted

Date: 2026-10-26

## Context

The catalog marks a product `prescriptionRequired`, and customer-web showed that as a badge only. sales-service had no reference to the flag, so a prescription-only product could be added to the cart and ordered online like any other. An order for one (Amoxicillin, `THU-0002`) was created in the local stack, which showed the gap. The project's decision is that these products are not sold through the online cart.

## Decision

- A product with `prescriptionRequired = true` cannot be added to the cart and cannot be ordered through `POST /api/orders`, whether the order uses `lines` or `fromCart`.
- sales-service reads the flag from catalog-service (`GET /products/:id`) and answers `409 prescription_required` with the `productId`. `POST /api/carts/merge` drops such lines and merges the rest, so a browser cart saved before this rule does not block sign-in.
- If the flag cannot be read (catalog-service fails or takes more than 2 seconds), the request fails with 500. It is not let through.
- customer-web disables the add-to-cart buttons ("Cần đơn thuốc"), replaces the buy buttons on the product page with a link to **Gửi đơn thuốc**, and refuses the product for a signed-out shopper before it reaches `localStorage`.
- A customer buys these products through **Gửi đơn thuốc**, a pharmacist's consultation, or the counter.

## Consequences

- The rule is enforced on the server, so a client that calls the API directly gets the same refusal.
- Each add-to-cart and each order with a new product costs one catalog-service call per product.
- k6, chaos and the sample import order by `lines`; the pickers in k6 and chaos skip prescription-only products so they do not hit the refusal.
- Changing the catalog flag on a product that is already in a cart takes effect at the next order or merge; the line stays in the cart until then and the order is refused.

## Related business rules

In [business-rules.md](../business-rules.md) (Vietnamese): BR-ORD-011, BR-CART-001.
