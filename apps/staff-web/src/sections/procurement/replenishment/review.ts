import type { DraftOrder, DraftOrdersBody, Suggestion } from "./contract.ts";

/**
 * Pure rules of the replenishment review: the supplier of each row, grouping, selection, edited quantities and the
 * draft-order body. No React or API imports, so node can test them. `choices` holds the supplier the user picked for a
 * row whose suggestion named none, keyed by product id; `quantities` holds the edited quantity text, keyed the same way.
 */

export type SupplierGroup = { supplierId: string | null; rows: Suggestion[] };

/** The supplier a row is drafted with: the one the suggestion names, else the one the user picked, else none. */
export const rowSupplierId = (row: Suggestion, choices: ReadonlyMap<string, string>): string | null =>
  row.supplierId ?? choices.get(row.productId) ?? null;

/** A row can be selected once it has a supplier to draft with. */
export const isSelectable = (row: Suggestion, choices: ReadonlyMap<string, string>): boolean =>
  rowSupplierId(row, choices) !== null;

/**
 * Groups rows by their effective supplier, in order of first appearance. Rows with no supplier yet form the last group,
 * so the groups read top to bottom as the orders they will become.
 */
export const groupBySupplier = (rows: readonly Suggestion[], choices: ReadonlyMap<string, string>): SupplierGroup[] => {
  const groups = new Map<string, Suggestion[]>();
  const unassigned: Suggestion[] = [];
  for (const row of rows) {
    const supplierId = rowSupplierId(row, choices);
    if (supplierId === null) {
      unassigned.push(row);
      continue;
    }
    const group = groups.get(supplierId);
    if (group) group.push(row);
    else groups.set(supplierId, [row]);
  }
  const grouped: SupplierGroup[] = [...groups].map(([supplierId, groupRows]) => ({ supplierId, rows: groupRows }));
  return unassigned.length > 0 ? [...grouped, { supplierId: null, rows: unassigned }] : grouped;
};

/** A new selection with the products added (`on`) or removed. The set passed in is never changed. */
export const setProductsSelected = (
  selected: ReadonlySet<string>,
  productIds: readonly string[],
  on: boolean,
): ReadonlySet<string> => {
  const next = new Set(selected);
  for (const productId of productIds) {
    if (on) next.add(productId);
    else next.delete(productId);
  }
  return next;
};

export type CheckState = "none" | "some" | "all";

/** The state of a group's check box: none, some or all of its selectable products are selected. */
export const selectionCheckState = (productIds: readonly string[], selected: ReadonlySet<string>): CheckState => {
  const count = productIds.filter((productId) => selected.has(productId)).length;
  if (count === 0) return "none";
  return count === productIds.length ? "all" : "some";
};

/** A whole number of 1 or more, or undefined. The text is trimmed; "0", "2.5", "-3" and "" are refused. */
export const parseOrderQuantity = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
};

/** The quantity text shown for a row: the user's edit, else the suggested quantity. */
export const quantityText = (row: Suggestion, quantities: ReadonlyMap<string, string>): string =>
  quantities.get(row.productId) ?? String(row.suggestedQuantity);

export type DraftPlan =
  | { ok: true; body: DraftOrdersBody; orderCount: number; lineCount: number }
  | { ok: false; invalidProductIds: string[] };

/**
 * The draft-order request for the selected rows: one order per supplier, in the order the groups show, one line per
 * selected row with its edited or suggested quantity. A selected row whose quantity is not a whole number of 1 or more
 * makes the plan refused, so nothing is sent until the user fixes it. No selection gives an empty plan.
 */
export const planDraftOrders = (
  rows: readonly Suggestion[],
  selected: ReadonlySet<string>,
  choices: ReadonlyMap<string, string>,
  quantities: ReadonlyMap<string, string>,
  siteId: string,
): DraftPlan => {
  const chosen = rows.filter((row) => selected.has(row.productId) && isSelectable(row, choices));
  const invalidProductIds: string[] = [];
  const orders: DraftOrder[] = [];
  for (const group of groupBySupplier(chosen, choices)) {
    if (group.supplierId === null) continue;
    const lines: DraftOrder["lines"] = [];
    for (const row of group.rows) {
      const orderedQuantity = parseOrderQuantity(quantityText(row, quantities));
      if (orderedQuantity === undefined) invalidProductIds.push(row.productId);
      else lines.push({ productId: row.productId, orderedQuantity });
    }
    if (lines.length > 0) orders.push({ supplierId: group.supplierId, lines });
  }
  if (invalidProductIds.length > 0) return { ok: false, invalidProductIds };
  return {
    ok: true,
    body: { siteId, orders },
    orderCount: orders.length,
    lineCount: orders.reduce((count, order) => count + order.lines.length, 0),
  };
};
