export const PROCUREMENT_TABS = ["Purchase orders", "Create order", "Goods receipts", "Receive goods"] as const;

export type ProcurementTab = (typeof PROCUREMENT_TABS)[number];

/** The tab named in the URL when it is one of ours, otherwise the page's default tab. */
export const toProcurementTab = (value: string, fallback: ProcurementTab): ProcurementTab =>
  (PROCUREMENT_TABS as readonly string[]).includes(value) ? (value as ProcurementTab) : fallback;
