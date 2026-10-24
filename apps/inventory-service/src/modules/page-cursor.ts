const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `timestamptz` rendered as UTC text with microseconds, exactly as `keyset-page.ts` selects it. */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CURSOR_LENGTH = 512;

/** The sort value and id of the last row a page answered: the keyset the next page starts after. */
export type PageCursor = { sortValue: string; id: string };
/** `timestamp` sort values are UTC text with microseconds; `date` sort values are calendar dates. */
export type CursorValueKind = "timestamp" | "date";
export type PageOptions = {
  kind: CursorValueKind;
  defaultLimit: number;
  maxLimit: number;
  /** Answers every row when the request sends neither `limit` nor `cursor`, as the list did before paging. */
  allWithoutLimit?: boolean;
};
/** `limit` undefined means the whole list; a cursor alone pages with the default size. */
export type PageRequest = { limit: number | undefined; cursor: PageCursor | undefined };

export const everything: PageRequest = { limit: undefined, cursor: undefined };

export const encodePageCursor = (position: PageCursor): string =>
  Buffer.from(JSON.stringify([position.sortValue, position.id])).toString("base64url");

/** The position a cursor stands for, or undefined when it was not made by `encodePageCursor` for this kind of sort. */
export const decodePageCursor = (cursor: string, kind: CursorValueKind): PageCursor | undefined => {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(decoded) || decoded.length !== 2) return undefined;
  const [sortValue, id] = decoded as unknown[];
  if (typeof sortValue !== "string" || typeof id !== "string") return undefined;
  if (!UUID_PATTERN.test(id) || !isSortValue(sortValue, kind)) return undefined;
  return { sortValue, id };
};

/**
 * Reads `limit` and `cursor` from a list request. Undefined means the cursor is not one this service made, which
 * the route answers with `400 invalid_cursor`. A non-numeric limit takes the default and an out-of-range one is
 * clamped, as the lists always did.
 */
export const readPageRequest = (
  query: { limit?: unknown; cursor?: unknown },
  options: PageOptions,
): PageRequest | undefined => {
  if (options.allWithoutLimit && query.limit === undefined && query.cursor === undefined) return everything;
  let cursor: PageCursor | undefined;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string") return undefined;
    cursor = decodePageCursor(query.cursor, options.kind);
    if (!cursor) return undefined;
  }
  return { limit: readLimit(query.limit, options), cursor };
};

/** The free-text `q` of a list, trimmed; blank text means no search. */
export const readSearchText = (query: { q?: unknown }): string | undefined => {
  if (typeof query.q !== "string") return undefined;
  const text = query.q.trim();
  return text.length > 0 ? text : undefined;
};

/** A comma-separated filter such as `status=Pending,Approved`; blank items are dropped and no item means no filter. */
export const readCommaList = (value: unknown): string[] | undefined => {
  if (typeof value !== "string") return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
};

/** A case-insensitive substring pattern for `ILIKE`, with `%`, `_` and the escape character taken literally. */
export const containsPattern = (text: string): string =>
  `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const readLimit = (value: unknown, options: PageOptions): number => {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return options.defaultLimit;
  return Math.min(Math.max(Math.trunc(parsed), 1), options.maxLimit);
};

const isSortValue = (value: string, kind: CursorValueKind): boolean => {
  if (kind === "date") return DATE_PATTERN.test(value) && isCalendarDate(value);
  if (!TIMESTAMP_PATTERN.test(value) || !isCalendarDate(value.slice(0, 10))) return false;
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  return hour < 24 && minute < 60 && second < 60;
};

/** Rejects dates the calendar does not have, such as February 31, which the database would refuse with a 500. */
const isCalendarDate = (value: string): boolean => {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
