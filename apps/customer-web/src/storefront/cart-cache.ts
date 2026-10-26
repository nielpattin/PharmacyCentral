import type { QueryClient } from "@tanstack/react-query";

import type { Cart, DeliveryAddress } from "../customer-api.ts";

/** Read by the header badge on every page. */
export const cartQueryKey = ["cart"] as const;
/** The checkout page renders its cart rows and saved destinations from this bootstrap payload. */
export const checkoutQueryKey = ["checkout-bootstrap"] as const;
/** The account page reads the signed-in shopper's profile and saved delivery addresses from here. */
export const accountQueryKey = ["customer-account"] as const;

type CheckoutBootstrap = { cart?: Cart | undefined; addresses?: DeliveryAddress[] | undefined };

/** Only a payload that is already there is amended: the checkout page owns what it bootstrapped. */
const writeCheckoutBootstrap = (queryClient: QueryClient, patch: CheckoutBootstrap): void => {
  queryClient.setQueryData(checkoutQueryKey, (current) =>
    current && typeof current === "object" ? { ...(current as CheckoutBootstrap), ...patch } : current,
  );
};

/**
 * Every cart mutation lands in both caches. Writing only `["cart"]` leaves the checkout page rendering the cart from
 * before the change: its bootstrap payload stays fresh for 30 seconds, so a shopper who adds an item from the
 * storefront and opens the cart would otherwise see the older list.
 */
export const writeCart = (queryClient: QueryClient, cart: Cart): void => {
  queryClient.setQueryData(cartQueryKey, cart);
  writeCheckoutBootstrap(queryClient, { cart });
};

/**
 * Saved delivery addresses are read by two pages from two caches: the checkout page offers them as delivery
 * destinations and the account page lists them for management. Writing only one leaves the other showing an address
 * that no longer exists, or hiding one that does.
 */
export const writeDeliveryAddresses = (queryClient: QueryClient, addresses: DeliveryAddress[]): void => {
  writeCheckoutBootstrap(queryClient, { addresses });
};

/**
 * A shopper who signs in may have filled the cart while signed out: the account cart, which now holds those lines, and
 * the addresses behind that identity have to reach the checkout cache, or its delivery panel offers the previous
 * visitor's saved points.
 */
export const mergeCartIntoCaches = (queryClient: QueryClient, cart: Cart, addresses: DeliveryAddress[]): void => {
  writeCart(queryClient, cart);
  writeDeliveryAddresses(queryClient, addresses);
};
