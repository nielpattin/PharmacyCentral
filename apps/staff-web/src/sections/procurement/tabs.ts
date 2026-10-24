import type { StaffAction } from "../../permissions/staff-permissions.ts";

export const PROCUREMENT_TABS = ["Purchase orders", "Create order", "Goods receipts", "Receive goods"] as const;

export type ProcurementTab = (typeof PROCUREMENT_TABS)[number];

/** The tab named in the URL when it is one of ours, otherwise the page's default tab. */
export const toProcurementTab = (value: string, fallback: ProcurementTab): ProcurementTab =>
  (PROCUREMENT_TABS as readonly string[]).includes(value) ? (value as ProcurementTab) : fallback;

/** The action behind each tab. A tab the signed-in role cannot use is not shown; `undefined` is open to all staff. */
export const PROCUREMENT_TAB_ACTIONS: Record<ProcurementTab, StaffAction | undefined> = {
  "Purchase orders": undefined,
  "Create order": "purchaseOrder.create",
  "Goods receipts": "goodsReceipt.view",
  "Receive goods": "goodsReceipt.create",
};
