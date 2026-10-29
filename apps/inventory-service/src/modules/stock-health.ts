/** Days without a ledger movement after which a product's stock at a site counts as dead stock (design 0007). */
export const DEAD_STOCK_DAYS = 90;

/** The expiry buckets of stock health: non-overlapping, counted in base units of on-hand stock. */
export type ExpiryBucket = "expired" | "expiring30" | "expiring60" | "expiring90";

/**
 * The UTC calendar dates the expiry buckets are cut on, for one moment. A batch expiring on `today` is not expired
 * yet (it stays sellable through its expiry date, as `sellableBatch` has it); the other dates are the last day of
 * each bucket: `within30` closes 0 to 30 days, `within60` closes 31 to 60, `within90` closes 61 to 90.
 */
export type ExpiryWindows = { today: string; within30: string; within60: string; within90: string };

/** One row per (site, product) of stock health, as the internal read answers it. Quantities are base units. */
export type StockHealthRow = {
  siteId: string;
  productId: string;
  onHand: number;
  reserved: number;
  dispensed: number;
  netChange: number;
  lastMovementAt: string | null;
  expired: number;
  expiring30: number;
  expiring60: number;
  expiring90: number;
};

/** What the goods handed over for one sale cost, as the internal read answers it. Quantities are base units, cost is VND. */
export type DispenseCostRow = {
  referenceType: "Order" | "Prescription";
  referenceId: string;
  quantity: number;
  costedQuantity: number;
  cost: number;
};

/** The most sales one dispense-cost read answers; a longer window is refused rather than cut. */
export const MAX_DISPENSE_COST_ROWS = 50_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The bucket boundaries for `asOf`, on the UTC calendar day of that moment. */
export const expiryWindows = (asOf: Date): ExpiryWindows => {
  const today = asOf.toISOString().slice(0, 10);
  return {
    today,
    within30: addDays(today, 30),
    within60: addDays(today, 60),
    within90: addDays(today, 90),
  };
};

/**
 * The bucket of a batch expiring on `expiryDate` (YYYY-MM-DD) as seen at `asOf`: `expired` before today, then
 * `expiring30` for today to 30 days later, `expiring60` for 31 to 60 days, `expiring90` for 61 to 90 days. A batch
 * further out than 90 days is in no bucket, so the answer is null.
 */
export const expiryBucket = (expiryDate: string, asOf: Date): ExpiryBucket | null => {
  const windows = expiryWindows(asOf);
  if (expiryDate < windows.today) return "expired";
  if (expiryDate <= windows.within30) return "expiring30";
  if (expiryDate <= windows.within60) return "expiring60";
  if (expiryDate <= windows.within90) return "expiring90";
  return null;
};
