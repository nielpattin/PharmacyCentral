import type { QueryKey } from "@tanstack/react-query";

/** Query keys a product write can change: the product list, product lookups, pickers and shared references. */
export const PRODUCT_QUERY_KEYS: readonly QueryKey[] = [
  ["staff-products"],
  ["staff-product"],
  ["staff-product-picker"],
  ["staff-references"],
];

/** Units are listed per product, and each product record embeds its units. */
export const unitQueryKey = (productId: string): QueryKey => ["staff-product-units", productId];

export const PRICE_QUERY_KEY: QueryKey = ["staff-prices"];
