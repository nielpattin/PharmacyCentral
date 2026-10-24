import type { StaffAction } from "../../permissions/staff-permissions.ts";

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

/** The action behind each tab. A tab the signed-in role cannot use is not shown; `undefined` is open to all staff. */
export const INVENTORY_TAB_ACTIONS: Record<InventoryTab, StaffAction | undefined> = {
  Balances: undefined,
  Batches: "inventory.records.view",
  "Create batch": "inventory.batch.create",
  Movements: "inventory.records.view",
  Adjustments: "inventory.records.view",
  Transfers: "inventory.records.view",
  "Create transfer": "inventory.transfer.create",
  Stocktake: "inventory.records.view",
  "Count line": "inventory.stocktake.count",
  Returns: "inventory.records.view",
  Replenishment: "replenishment.view",
};
