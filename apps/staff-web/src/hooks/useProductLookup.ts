import { useQueries, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";

import { readOne, text, type JsonRecord } from "../staff-api.ts";

const unitsSchema = z.array(z.record(z.string(), z.unknown()));

/**
 * Product records by id. Each id is one `GET /api/products/{id}`, cached under `["staff-product", id]`, so the product
 * picker, the price list and any other screen that names a product share one request per product. The record carries
 * its `units`, so a unit name needs no second request.
 *
 * Usage:
 *   const products = useProductLookup(rows.map((row) => text(row.productId, "")));
 *   const label = productLabel(products.get(id), id);
 */
export const productQueryKey = (id: string): QueryKey => ["staff-product", id];

export const useProductLookup = (ids: readonly string[]): Map<string, JsonRecord> => {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  const queries = useQueries({
    queries: unique.map((id) => ({
      queryKey: productQueryKey(id),
      queryFn: () => readOne(`/api/products/${encodeURIComponent(id)}`),
    })),
  });
  const products = new Map<string, JsonRecord>();
  unique.forEach((id, index) => {
    const data = queries[index]?.data;
    if (data !== undefined) products.set(id, data);
  });
  return products;
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
