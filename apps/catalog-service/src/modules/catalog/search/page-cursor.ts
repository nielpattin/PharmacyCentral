const MAX_OFFSET_DIGITS = 6;

/** The cursor of the page that starts `offset` results in. It is opaque to callers: they hand back what they were given. */
export const encodeCursor = (offset: number): string => Buffer.from(String(offset)).toString("base64url");

/** The offset a cursor stands for, or undefined when it was not made by `encodeCursor`. */
export const decodeCursor = (cursor: string): number | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return undefined;
  const text = Buffer.from(cursor, "base64url").toString();
  if (!new RegExp(`^[1-9][0-9]{0,${MAX_OFFSET_DIGITS - 1}}$`).test(text)) return undefined;
  return Number(text);
};
