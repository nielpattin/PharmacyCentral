/** Tabs of the inventory area, in display order. The value is also the `tab` search param and the English label. */
export const INVENTORY_TABS = [
  "Balances",
  "Batches",
  "Create batch",
  "Movements",
  "Adjustments",
  "Transfers",
  "Create transfer",
  "Stocktake",
  "Count line",
  "Returns",
  "Replenishment",
] as const;

export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const isInventoryTab = (value: string): value is InventoryTab =>
  (INVENTORY_TABS as readonly string[]).includes(value);
