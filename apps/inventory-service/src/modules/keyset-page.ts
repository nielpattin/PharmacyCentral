import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { Response } from "express";

import { encodePageCursor, type CursorValueKind, type PageCursor } from "./page-cursor.ts";

export type Page<Row> = { rows: Row[]; nextCursor: string | undefined };

/** What a keyset query selects per row: the row itself, its id, and its sort column as cursor text. */
export type KeysetItem = { id: string; sortValue: string };

/** The sort column as the text a cursor carries: UTC with microseconds, so the next page compares what was stored. */
export const timestampSortValue = (column: SQLWrapper) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const dateSortValue = (column: SQLWrapper) => sql<string>`to_char(${column}, 'YYYY-MM-DD')`;

/**
 * The rows after a cursor in `(sortColumn, idColumn)` order. The row comparison selects exactly the rows the previous
 * page did not reach, so no row is repeated or skipped even when several rows share a sort value.
 */
export const afterCursor = (input: {
  sortColumn: SQLWrapper;
  idColumn: SQLWrapper;
  direction: "asc" | "desc";
  kind: CursorValueKind;
  cursor: PageCursor | undefined;
}): SQL | undefined => {
  const { cursor } = input;
  if (!cursor) return undefined;
  const sortValue = input.kind === "date" ? sql`${cursor.sortValue}::date` : sql`${cursor.sortValue}::timestamptz`;
  const id = sql`${cursor.id}::uuid`;
  return input.direction === "asc"
    ? sql`(${input.sortColumn}, ${input.idColumn}) > (${sortValue}, ${id})`
    : sql`(${input.sortColumn}, ${input.idColumn}) < (${sortValue}, ${id})`;
};

/** Drops the conditions a filter left out, keeping the ones that apply. */
export const presentConditions = <Condition>(conditions: Array<Condition | undefined>): Condition[] =>
  conditions.filter((condition): condition is Condition => condition !== undefined);

/**
 * Splits the `limit + 1` items a keyset query fetched into the page and, when one more item exists, the cursor of the
 * last item kept. Without a limit every item is the page and no cursor follows.
 */
export const splitPage = <Item extends KeysetItem>(
  fetched: Item[],
  limit: number | undefined,
): { items: Item[]; nextCursor: string | undefined } => {
  if (limit === undefined) return { items: fetched, nextCursor: undefined };
  const items = fetched.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      fetched.length > limit && last ? encodePageCursor({ sortValue: last.sortValue, id: last.id }) : undefined,
  };
};

/** The array body stays as it was; the cursor of the next page travels in a header, present only when one follows. */
export const sendPage = <Row>(response: Response, page: Page<Row>): void => {
  if (page.nextCursor !== undefined) response.set("X-Next-Cursor", page.nextCursor);
  response.json(page.rows);
};

export const invalidCursor = (response: Response): void => {
  response.status(400).json({ title: "Invalid cursor", status: 400, code: "invalid_cursor" });
};
