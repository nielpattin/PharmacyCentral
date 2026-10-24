/**
 * Cursor paging helpers. A list endpoint returns a bare array and, only when more rows exist, an opaque cursor in the
 * `X-Next-Cursor` header. Usage: see hooks/usePagedList.ts and staff-api.ts `requestPage`.
 */
export const NEXT_CURSOR_HEADER = "X-Next-Cursor";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Null on the last page. A value that is not an opaque base64url cursor is an error, never a silent end of list. */
export const parseNextCursor = (header: string | null | undefined): string | null => {
  if (header === null || header === undefined) return null;
  const cursor = header.trim();
  if (cursor === "") return null;
  if (!CURSOR_PATTERN.test(cursor)) throw new Error(`Malformed ${NEXT_CURSOR_HEADER} header`);
  return cursor;
};

/** Appends the params that have a value, keeping the order given. */
export const buildPagePath = (path: string, params: Readonly<Record<string, string | undefined>>): string => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(name, value);
  }
  const search = query.toString();
  if (search === "") return path;
  return `${path}${path.includes("?") ? "&" : "?"}${search}`;
};
