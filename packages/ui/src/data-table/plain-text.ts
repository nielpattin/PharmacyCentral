/** Plain-text form of a cell value: null and undefined become "", objects become JSON. */
export const toPlainText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  if (typeof value === "symbol") return value.description ?? "";
  if (typeof value === "function") return value.name;
  if (typeof value === "object") return JSON.stringify(value);
  return "";
};
