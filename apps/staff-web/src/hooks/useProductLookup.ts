import { useQueries, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";

import { queryClient } from "../query-client.ts";
import { readOne, text, type JsonRecord } from "../staff-api.ts";

const unitsSchema = z.array(z.record(z.string(), z.unknown()));

export type ProductLookup = { get: (id: string) => JsonRecord | undefined };

/**
 * Product records by id. Each id is one `GET /api/products/{id}`, cached under `["staff-product", id]`, so the product
 * picker, the price list and any other screen that names a product share one request per product. The record carries
 * its `units`, so a unit name needs no second request.
 *
 * `get` reads the cache when it is called, not when the table last rendered, so a column that names a product also
 * names the ones `loadProducts` fetched after that render (the rows a CSV export reads past the loaded pages).
 *
 * Usage:
 *   const products = useProductLookup(rows.map((row) => text(row.productId, "")));
 *   const label = productLabel(products.get(id), id);
 */
export const productQueryKey = (id: string): QueryKey => ["staff-product", id];

const productQuery = (id: string) => ({
  queryKey: productQueryKey(id),
  queryFn: () => readOne(`/api/products/${encodeURIComponent(id)}`),
});

const distinct = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => id !== ""))];

export const useProductLookup = (ids: readonly string[]): ProductLookup => {
  useQueries({ queries: distinct(ids).map(productQuery) });
  return { get: (id) => queryClient.getQueryData<JsonRecord>(productQueryKey(id)) };
};

/**
 * Reads the products a table has not loaded yet, so an export that names them finds every one in the cache. A product
 * that cannot be read is skipped, and keeps its short id.
 */
export const loadProducts = async (ids: readonly string[]): Promise<void> => {
  await Promise.allSettled(distinct(ids).map((id) => queryClient.ensureQueryData(productQuery(id))));
};

/** "SKU - Name", or the fallback (usually the id) while the record is not loaded. */
export const productLabel = (product: JsonRecord | undefined, fallback: string): string => {
  if (!product) return fallback;
  const label = [text(product.sku, ""), text(product.name, "")].filter(Boolean).join(" - ");
  return label || fallback;
};

/** The units embedded in a product record, in sort order. */
export const productUnits = (product: JsonRecord | undefined): JsonRecord[] => {
  const parsed = unitsSchema.safeParse(product?.units);
  return parsed.success ? parsed.data : [];
};
