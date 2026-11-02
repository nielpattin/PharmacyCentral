/**
 * Groups of the catalog's Redis read cache. Each write path drops the groups its change can affect; see
 * `catalog-routes.ts` and `main.ts`. Only answers that are the same for every caller of the same key are cached: the
 * caller identity, sessions and every employee-scoped list stay out.
 */
export const CATALOG_CACHE_NAMESPACE = "pharmacy:catalog:v1";

export const CATALOG_CACHE_TTL_SECONDS = {
  /** Store list and store detail: changed by staff rarely, dropped on every site write. */
  stores: 60,
  /** Product detail with its units. */
  products: 30,
  /** Active price of one product unit: a shopper's price must not lag a published change for long. */
  prices: 15,
  /** Stock projection per site: changes with every stock event, so the shortest window. */
  availability: 5,
} as const;

export type CatalogCacheGroup = keyof typeof CATALOG_CACHE_TTL_SECONDS;
