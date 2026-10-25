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
] as const;

export type InventoryTab = (typeof INVENTORY_TABS)[number];

export const isInventoryTab = (value: string): value is InventoryTab =>
  (INVENTORY_TABS as readonly string[]).includes(value);

/** Tabs by what staff do with them. The group id is also its English label. */
export const INVENTORY_GROUPS: ReadonlyArray<{ id: string; tabs: readonly InventoryTab[] }> = [
  { id: "Stock", tabs: ["Balances", "Batches", "Movements"] },
  { id: "Supply", tabs: ["Transfers", "Replenishment", "Returns"] },
  { id: "Control", tabs: ["Adjustments", "Stocktake"] },
];

/** The action behind each tab. A tab the signed-in role cannot use is not shown; `undefined` is open to all staff. */
export const INVENTORY_TAB_ACTIONS: Record<InventoryTab, StaffAction | undefined> = {
  Balances: undefined,
  Batches: "inventory.records.view",
  Movements: "inventory.records.view",
  Transfers: "inventory.records.view",
  Replenishment: "replenishment.view",
  Returns: "inventory.records.view",
  Adjustments: "inventory.records.view",
  Stocktake: "inventory.records.view",
};

export type VisibleGroup = { id: string; tabs: InventoryTab[] };

/** The groups with only the tabs in `visible`; a group left with none is dropped. */
export const visibleGroups = (visible: readonly InventoryTab[]): VisibleGroup[] =>
  INVENTORY_GROUPS.map((group) => ({ id: group.id, tabs: group.tabs.filter((tab) => visible.includes(tab)) })).filter(
    (group) => group.tabs.length > 0,
  );
