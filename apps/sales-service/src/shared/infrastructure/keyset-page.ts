import { sql, type AnyColumn, type SQL } from "drizzle-orm";

import { encodeCursor, type Page, type PageCursor } from "../page-cursor.ts";

/** The creation time as UTC text at microsecond precision: the sort value a cursor carries. */
export const createdAtSortKey = (createdAt: AnyColumn) =>
  sql<string>`to_char(${createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The rows that come after `cursor` in `(createdAt DESC, id DESC)` order; undefined on the first page. */
export const afterCursor = (createdAt: AnyColumn, id: AnyColumn, cursor: PageCursor | undefined): SQL | undefined =>
  cursor ? sql`(${createdAt}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined;

/** Keeps the endpoint's own bounds: a request below one or above the maximum is pulled back to it. */
export const clampLimit = (limit: number, max = 500): number => Math.min(Math.max(limit, 1), max);

/** `q` as a case-insensitive substring pattern; `%`, `_` and the escape character match only themselves. */
export const containsPattern = (text: string): string => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * Turns the `limit + 1` rows that were fetched into one page. The extra row only proves another page exists, and the
 * cursor names the last row kept, so the next page starts right after it.
 */
export const toPage = <T extends { id: string; sortKey: string }>(
  fetched: T[],
  limit: number,
): Page<Omit<T, "sortKey">> => {
  const hasMore = fetched.length > limit;
  const kept = fetched.slice(0, limit);
  const last = kept.at(-1);
  return {
    rows: kept.map(({ sortKey: _sortKey, ...row }) => row),
    nextCursor: hasMore && last ? encodeCursor({ at: last.sortKey, id: last.id }) : undefined,
  };
};
