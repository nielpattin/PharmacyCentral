import type { JsonRecord } from "../../staff-api.ts";

/** Pure helpers: no React, no i18n, so they can be unit tested in node. */

export const asRecord = (value: unknown): JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};

export const stringField = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
};

/** The first 8 characters of an id, for a label when no name is known. */
export const shortId = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id);

/** A reference label, or the short id when the row is not loaded (`referenceLabel` returns the full id then). */
export const labelOrShortId = (label: string, id: string): string => (label === id ? shortId(id) : label);
