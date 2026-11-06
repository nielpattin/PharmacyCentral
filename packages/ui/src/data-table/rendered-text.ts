import { isValidElement, type ReactNode } from "react";

/**
 * The text a rendered cell shows: strings and numbers as they are, an element's children joined, and nothing for
 * null, booleans or an element with no text children (an icon, a button without a label). A CSV export reads this so
 * the file holds what the table shows ("Đã hủy", "#6845698B", "3") rather than the raw field ("Cancelled", a UUID, an array).
 */
export const renderedText = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return renderedText(node.props.children);
  return "";
};
