import type { StaffAction } from "../../permissions/staff-permissions.ts";

export const PROCUREMENT_TABS = ["Purchase orders", "Goods receipts", "Reorder suggestions"] as const;

export type ProcurementTab = (typeof PROCUREMENT_TABS)[number];

/** The tab named in the URL when it is one of ours, otherwise the page's default tab. Old `Create order` and `Receive goods` links land here too. */
export const toProcurementTab = (value: string, fallback: ProcurementTab): ProcurementTab =>
  (PROCUREMENT_TABS as readonly string[]).includes(value) ? (value as ProcurementTab) : fallback;

/** The action that opens each tab. A tab the signed-in role cannot use is not shown; `undefined` is open to all staff. */
export const PROCUREMENT_TAB_ACTIONS: Record<ProcurementTab, StaffAction | undefined> = {
  "Purchase orders": undefined,
  "Goods receipts": "goodsReceipt.view",
  "Reorder suggestions": "replenishment.suggestions.view",
};

/** The action behind each tab's header create button, and the label it carries. A tab without an entry has no header button. */
export const PROCUREMENT_CREATE: Partial<Record<ProcurementTab, { action: StaffAction; label: string }>> = {
  "Purchase orders": { action: "purchaseOrder.create", label: "Create order" },
  "Goods receipts": { action: "goodsReceipt.create", label: "Receive goods" },
};
