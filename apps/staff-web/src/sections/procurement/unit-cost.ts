/**
 * The purchase cost typed on a goods receipt line: dong per unit received, before VAT. Blank means the cost is not
 * known, which is stored as no cost and never as 0 (a free batch would show a false profit).
 */
export type UnitCostResult = { ok: true; value: number | null } | { ok: false; message: string };

const MAX_UNIT_COST = 1_000_000_000;

export const parseUnitCost = (input: string): UnitCostResult => {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: null };
  // A plain decimal with a dot; a comma or a thousands separator would be read differently by every locale.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      message: /^-/.test(trimmed)
        ? "The unit cost cannot be negative."
        : "The unit cost must be a number with at most 2 decimals.",
    };
  }
  const value = Number(trimmed);
  if (value > MAX_UNIT_COST) return { ok: false, message: "The unit cost is too large." };
  return { ok: true, value };
};

/** The first line whose cost cannot be sent, with its 1-based position; undefined when every line is fine. */
export const firstUnitCostError = (costs: readonly string[]): { line: number; message: string } | undefined => {
  for (const [index, cost] of costs.entries()) {
    const result = parseUnitCost(cost);
    if (!result.ok) return { line: index + 1, message: result.message };
  }
  return undefined;
};
