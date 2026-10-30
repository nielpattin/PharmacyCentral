import type { StaffAction } from "../../permissions/staff-permissions.ts";

/**
 * Tabs of the inventory area, in display order. The value is also the `tab` search param and the English label. Creating
 * a batch or transfer and recording a count are drawers opened from their list, not tabs.
 */
export const INVENTORY_TABS = [
  "Balances",
  "Batches",
  "Movements",
  "Transfers",
  "Replenishment",
  "Returns",
  "Adjustments",
  "Stocktake",
  "Disposals",
] as const;

export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const isInventoryTab = (value: string): value is InventoryTab =>
  (INVENTORY_TABS as readonly string[]).includes(value);

/** Tabs by what staff do with them. The group id is also its English label. */
export const INVENTORY_GROUPS: ReadonlyArray<{ id: string; tabs: readonly InventoryTab[] }> = [
  { id: "Stock", tabs: ["Balances", "Batches", "Movements"] },
  { id: "Supply", tabs: ["Transfers", "Replenishment", "Returns"] },
  { id: "Control", tabs: ["Adjustments", "Stocktake", "Disposals"] },
];

/** The action behind each tab. A tab the signed-in role cannot use is not shown; `undefined` is open to all staff. */
export const INVENTORY_TAB_ACTIONS: Record<InventoryTab, StaffAction | undefined> = {
  Balances: "inventory.balances.view",
  Batches: "inventory.batches.view",
  Movements: "inventory.movements.view",
  Transfers: "inventory.transfers.view",
  Replenishment: "replenishment.view",
  Returns: "inventory.returns.view",
  Adjustments: "inventory.adjustments.view",
  Stocktake: "inventory.stocktake.view",
  Disposals: "inventory.disposals.view",
};

export type VisibleGroup = { id: string; tabs: InventoryTab[] };

/** The groups with only the tabs in `visible`; a group left with none is dropped. */
export const visibleGroups = (visible: readonly InventoryTab[]): VisibleGroup[] =>
  INVENTORY_GROUPS.map((group) => ({ id: group.id, tabs: group.tabs.filter((tab) => visible.includes(tab)) })).filter(
    (group) => group.tabs.length > 0,
  );
