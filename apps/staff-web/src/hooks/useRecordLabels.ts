import { useQueries } from "@tanstack/react-query";

import { queryClient } from "../query-client.ts";
import { readOne, type JsonRecord } from "../staff-api.ts";

export type RecordLabels = { get: (id: string) => string | undefined };

const labelQuery = (basePath: string, id: string) => ({
  queryKey: ["staff-record-label", basePath, id],
  queryFn: () => readOne<JsonRecord>(`${basePath}/${encodeURIComponent(id)}`),
  staleTime: 5 * 60_000,
  retry: false,
});

const distinct = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => id !== ""))];

/**
 * Human labels for the ids of one record type, read one record at a time from its detail route (for example products
 * from `/api/products/{id}`). Each record is cached for five minutes. An id whose read has not finished, or has failed,
 * has no label, so callers fall back to a short id. `get` reads the cache when it is called, so it also finds the records
 * `loadRecordLabels` fetched after the last render.
 *
 * Usage:
 *   const labels = useRecordLabels("/api/products", lines.map((line) => line.productId), productLabel);
 *   labels.get(productId); // string | undefined
 */
export const useRecordLabels = (
  basePath: string,
  ids: readonly string[],
  toLabel: (row: JsonRecord) => string,
): RecordLabels => {
  useQueries({ queries: distinct(ids).map((id) => labelQuery(basePath, id)) });
  return {
    get: (id) => {
      const row = queryClient.getQueryData<JsonRecord>(labelQuery(basePath, id).queryKey);
      return row ? toLabel(row) : undefined;
    },
  };
};

/** Reads the records a table has not loaded yet. A record that cannot be read is skipped, and keeps its short id. */
export const loadRecordLabels = async (basePath: string, ids: readonly string[]): Promise<void> => {
  await Promise.allSettled(distinct(ids).map((id) => queryClient.ensureQueryData(labelQuery(basePath, id))));
};
