import type { QueryClient } from "@tanstack/react-query";

import type { Cart } from "../customer-api.ts";

/** Read by the header badge on every page. */
export const cartQueryKey = ["cart"] as const;
/** The checkout page renders its cart rows from this bootstrap payload. */
export const checkoutQueryKey = ["checkout-bootstrap"] as const;

/**
 * Every cart mutation lands in both caches. Writing only `["cart"]` leaves the checkout page rendering the cart from
 * before the change: its bootstrap payload stays fresh for 30 seconds, so a shopper who adds an item from the
 * storefront and opens the cart would otherwise see the older list.
 */
export const writeCart = (queryClient: QueryClient, cart: Cart): void => {
  queryClient.setQueryData(cartQueryKey, cart);
  queryClient.setQueryData(checkoutQueryKey, (current) =>
    current && typeof current === "object" ? { ...current, cart } : current,
  );
};
