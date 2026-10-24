import { useQueries } from "@tanstack/react-query";

import { readOne, type JsonRecord } from "../staff-api.ts";

/**
 * Human labels for the ids of one record type, read one record at a time from its detail route (for example products
 * from `/api/products/{id}`). Each record is cached for five minutes. An id whose read has not finished, or has failed,
 * has no entry, so callers fall back to a short id.
 *
 * Usage:
 *   const labels = useRecordLabels("/api/products", lines.map((line) => line.productId), productLabel);
 *   labels.get(productId); // string | undefined
 */
export const useRecordLabels = (
  basePath: string,
  ids: readonly string[],
  toLabel: (row: JsonRecord) => string,
): ReadonlyMap<string, string> => {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  const queries = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["staff-record-label", basePath, id],
      queryFn: () => readOne<JsonRecord>(`${basePath}/${encodeURIComponent(id)}`),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const labels = new Map<string, string>();
  unique.forEach((id, index) => {
    const row = queries[index]?.data;
    if (row) labels.set(id, toLabel(row));
  });
  return labels;
};
