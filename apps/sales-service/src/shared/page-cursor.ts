import { z } from "zod";

/**
 * A keyset position in a list ordered by `(createdAt DESC, id DESC)`. `at` is the creation time as UTC text at
 * microsecond precision: a JavaScript Date keeps only milliseconds, so a row written inside the same millisecond as the
 * last row of a page would be skipped or repeated by the next page.
 */
export type PageCursor = { at: string; id: string };

/** One page of a keyset list, and the cursor of the page after it when more rows exist. */
export type Page<T> = { rows: T[]; nextCursor: string | undefined };

/** The shape `to_char` produces for a microsecond UTC instant; the year may not be `0000`, which Postgres refuses. */
const MICROSECOND_INSTANT = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const cursorPayload = z.strictObject({
  at: z.string().regex(MICROSECOND_INSTANT),
  id: z.uuid(),
});

/** Rejects a well-formed text that names no calendar instant, such as February 30 or 25:00, before Postgres sees it. */
const isCalendarInstant = (at: string): boolean => {
  const prefix = at.slice(0, 19);
  const milliseconds = Date.parse(`${prefix}Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 19) === prefix;
};

/** The opaque cursor of a page: base64url of the keyset position. Callers hand back what they were given. */
export const encodeCursor = (position: PageCursor): string =>
  Buffer.from(JSON.stringify({ at: position.at, id: position.id })).toString("base64url");

/** The position a cursor stands for, or undefined when it was not made by `encodeCursor` or has been altered. */
export const decodeCursor = (cursor: string): PageCursor | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const parsed = cursorPayload.safeParse(payload);
  if (!parsed.success || !isCalendarInstant(parsed.data.at)) return undefined;
  return parsed.data;
};

/**
 * Reads the `cursor` query parameter. Absent means the first page; a repeated parameter or one that does not decode
 * is malformed and answers `invalid_cursor`.
 */
export const readCursorParam = (value: unknown): { ok: true; cursor: PageCursor | undefined } | { ok: false } => {
  if (value === undefined) return { ok: true, cursor: undefined };
  if (typeof value !== "string") return { ok: false };
  const cursor = decodeCursor(value);
  return cursor ? { ok: true, cursor } : { ok: false };
};
