import { referenceLabel } from "../../hooks/useStaffReferences.ts";
import { text, type JsonRecord } from "../../staff-api.ts";

/** The first eight characters of an id, upper-cased: the short reference the order screens already show. */
export const shortId = (value: unknown): string => text(value, "").slice(0, 8).toUpperCase();

/** The name from a reference list, or the short id while the list does not hold the row. */
export const referenceName = (rows: JsonRecord[], id: unknown, nameKeys: string[]): string => {
  const label = referenceLabel(rows, id, nameKeys);
  return label === text(id, "") ? shortId(id) || "-" : label;
};

/** Customer label from identity-service: display name, then email, then phone. */
export const customerLabel = (row: JsonRecord): string =>
  [text(row.displayName, ""), text(row.email, ""), text(row.phoneNumber, "")].find(Boolean) ?? shortId(row.id);

/** Order references use the same `#` plus short id the online orders screen shows. */
export const orderLabel = (orderId: unknown): string => `#${shortId(orderId)}`;
