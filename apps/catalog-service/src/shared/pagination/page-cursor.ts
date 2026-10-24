import { z } from "zod";

/** Where a keyset page continues: the sort value of its last row, and that row's id, which breaks ties. */
export type KeysetPosition = { sortValue: string; id: string };

/** A page of a keyset query, and whether rows exist after it. */
export type KeysetPage<T> = { rows: T[]; hasMore: boolean };

const MAX_CURSOR_LENGTH = 512;

/** The cursor of the page that starts after `position`. Callers treat it as opaque and hand it back unchanged. */
export const encodePageCursor = (position: KeysetPosition): string =>
  Buffer.from(JSON.stringify([position.sortValue, position.id]), "utf8").toString("base64url");

/**
 * The position a cursor stands for, or undefined when it was not made by `encodePageCursor` or its sort value is not
 * one `sortValue` accepts. The sort value is checked here so a tampered value never reaches the database, where it
 * would fail as a server error instead of a 400.
 */
export const decodePageCursor = (cursor: string, sortValue: z.ZodType<string>): KeysetPosition | undefined => {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const position = z.tuple([sortValue, z.string().uuid()]).safeParse(decoded);
  return position.success ? { sortValue: position.data[0], id: position.data[1] } : undefined;
};

/** Splits the `limit + 1` rows a keyset query fetched into the page itself and the flag that another page follows. */
export const takeKeysetPage = <T>(fetched: T[], limit: number): KeysetPage<T> => ({
  rows: fetched.slice(0, limit),
  hasMore: fetched.length > limit,
});
