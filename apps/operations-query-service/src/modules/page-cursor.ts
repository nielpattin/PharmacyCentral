const SORT_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 512;

/**
 * A keyset position: the sort value of the last row a page returned, and that row's id as the tie-breaker.
 * `sortAt` is the UTC text Postgres prints with microseconds (see `sortAtSql` in the repository), so the position
 * compares exactly; a JavaScript Date would drop the microseconds and could skip rows that share a millisecond.
 */
export type PageCursor = { sortAt: string; id: string };

/** The opaque cursor of the page that follows `position`. Callers hand it back unchanged. */
export const encodePageCursor = (position: PageCursor): string =>
  Buffer.from(JSON.stringify([position.sortAt, position.id]), "utf8").toString("base64url");

/** The position a cursor stands for, or undefined when it was not made by `encodePageCursor`. */
export const decodePageCursor = (cursor: string): PageCursor | undefined => {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [sortAt, id] = parsed as [unknown, unknown];
  if (typeof sortAt !== "string" || typeof id !== "string") return undefined;
  if (!SORT_AT_PATTERN.test(sortAt) || !UUID_PATTERN.test(id)) return undefined;
  // The shape can be right while the day is not (2026-02-31): such a value rolls over and fails the round trip.
  const time = Date.parse(sortAt);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 19) !== sortAt.slice(0, 19)) return undefined;
  return { sortAt, id };
};
