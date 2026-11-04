import type { Section } from "../../router.ts";

export type OperationsPersona = "manager" | "warehouse";

/** The counts of `GET /api/dashboard/summary` that become "Needs attention" tiles. */
export type TileField =
  | "pendingAdjustmentCount"
  | "lowStockBatchCount"
  | "expiringBatchCount"
  | "openPrescriptionCount"
  | "pendingTransferCount"
  | "openStocktakeCount";

export type TileSpec = {
  label: string;
  field: TileField;
  /** The page that handles the queue. */
  section: Section;
  /** Carries the warning dot while its count is above zero. */
  warn?: boolean;
};

const ADJUSTMENTS: TileSpec = { label: "Pending adjustments", field: "pendingAdjustmentCount", section: "adjustments" };
const LOW_STOCK: TileSpec = {
  label: "Low stock batches",
  field: "lowStockBatchCount",
  section: "replenishment",
  warn: true,
};
const EXPIRING: TileSpec = { label: "Expiring batches", field: "expiringBatchCount", section: "quality", warn: true };
const PRESCRIPTIONS: TileSpec = {
  label: "Open prescriptions",
  field: "openPrescriptionCount",
  section: "prescriptions",
};
const TRANSFERS: TileSpec = { label: "Pending transfers", field: "pendingTransferCount", section: "transfers" };
const STOCKTAKES: TileSpec = { label: "Open stocktakes", field: "openStocktakeCount", section: "stocktake" };

/**
 * The queues a role works, most pressing first. A manager decides: adjustments wait for their approval, then the stock
 * that is low or expiring. A warehouse member moves stock: transfers first, and no prescriptions, which they cannot open.
 */
export const operationsTiles = (persona: OperationsPersona): readonly TileSpec[] =>
  persona === "manager"
    ? [ADJUSTMENTS, LOW_STOCK, EXPIRING, PRESCRIPTIONS, TRANSFERS, STOCKTAKES]
    : [TRANSFERS, LOW_STOCK, STOCKTAKES, ADJUSTMENTS, EXPIRING];

/** A count shows the warning dot only when the tile can warn, the server answered, and the answer is above zero. */
export const tileWarns = (spec: TileSpec, value: unknown): boolean =>
  spec.warn === true && typeof value === "number" && Number.isFinite(value) && value > 0;

const WAREHOUSE_ACTION_PREFIXES = ["inventory.", "procurement."] as const;

/**
 * Whether the recent-activity feed lists an audit action for this persona. Warehouse staff see inventory and
 * procurement actions only (spec US4). This narrows what the page shows; the server is what must refuse the rest.
 */
export const feedShowsAction = (persona: OperationsPersona, action: string): boolean =>
  persona === "manager" || WAREHOUSE_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
