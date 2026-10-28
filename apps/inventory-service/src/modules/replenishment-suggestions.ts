/**
 * The replenishment formulas of BR-PROC-007 and design 0007. Pure: the repository supplies stock, ledger, open purchase
 * order and receipt figures, and the caller supplies the clock. Quantities are base units; durations are days.
 */

/**
 * The low-stock threshold of BR-REPORT-002: a balance whose available quantity is at or below 10 base units is low
 * stock. It is also the floor of a product's minimum stock.
 */
export const LOW_STOCK_THRESHOLD = 10;

/** Receipts of the last 12 months feed the lead-time history (BR-PROC-007). */
export const LEAD_TIME_HISTORY_MONTHS = 12;

/**
 * Rounds to six decimals, which removes float noise (0.1 * 3 is 0.30000000000000004) before a comparison or a ceiling,
 * so a quantity that is whole in base units is not pushed up by one.
 */
const settle = (value: number): number => Math.round(value * 1e6) / 1e6;

export type ReplenishmentParams = {
  windowDays: number;
  coverDays: number;
  safetyDays: number;
  defaultLeadTimeDays: number;
};

/** One product's position at the site. `supplierId` is the supplier of its latest receipt, else null. */
export type ProductStockPosition = {
  productId: string;
  onHand: number;
  reserved: number;
  /** Base units with a `Dispense` ledger entry at the site in the window; positive. */
  dispensedQuantity: number;
  /** Ordered minus received on open purchase orders at the site; never negative. */
  inboundQuantity: number;
  supplierId: string | null;
};

/** The lead time of one purchase order: days from its creation to its first goods receipt. */
export type LeadTimeSample = { supplierId: string; days: number };

export type LeadTime = {
  leadTimeDays: number;
  leadTimeSource: "history" | "default";
  sampleCount: number;
};

export type ReplenishmentSuggestion = {
  productId: string;
  supplierId: string | null;
  dailyVelocity: number;
  dispensedQuantity: number;
  onHand: number;
  reserved: number;
  available: number;
  inboundQuantity: number;
  minimumStock: number;
  leadTimeDays: number;
  leadTimeSource: LeadTime["leadTimeSource"];
  sampleCount: number;
  reorderPoint: number;
  targetStock: number;
  suggestedQuantity: number;
  daysOfCover: number | null;
};

/** Base units dispensed per day over the window. */
export const dailyVelocity = (dispensedQuantity: number, windowDays: number): number => dispensedQuantity / windowDays;

/** The larger of the low-stock threshold and `velocity × safetyDays`. */
export const minimumStock = (velocity: number, safetyDays: number): number =>
  Math.max(LOW_STOCK_THRESHOLD, velocity * safetyDays);

/** The median of the samples, or undefined with none. An even count averages the two middle samples. */
export const medianDays = (samples: readonly number[]): number | undefined => {
  const sorted = [...samples].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  const upper = sorted[half];
  const lower = sorted[half - 1];
  if (upper === undefined) return undefined;
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2;
};

/**
 * The lead time used for a product: the median of its supplier's samples, rounded up to whole days (a late delivery
 * is planned for, never hoped away). Without samples, the user's default, marked as such.
 */
export const leadTime = (samples: readonly number[], defaultLeadTimeDays: number): LeadTime => {
  const median = medianDays(samples);
  if (median === undefined) return { leadTimeDays: defaultLeadTimeDays, leadTimeSource: "default", sampleCount: 0 };
  return { leadTimeDays: Math.ceil(settle(median)), leadTimeSource: "history", sampleCount: samples.length };
};

/** Stock at which a new order must go out: the demand of the lead time plus the minimum stock. */
export const reorderPoint = (velocity: number, leadTimeDays: number, minimum: number): number =>
  velocity * leadTimeDays + minimum;

/** The stock an order should bring the site back to: the lead time and the cover period, plus the minimum stock. */
export const targetStock = (velocity: number, leadTimeDays: number, coverDays: number, minimum: number): number =>
  velocity * (leadTimeDays + coverDays) + minimum;

/** Units to order to reach the target, rounded up, and at least one unit. */
export const suggestedQuantity = (target: number, available: number, inbound: number): number =>
  Math.max(1, Math.ceil(settle(target - available - inbound)));

/** Days the available stock lasts at the current velocity; null when nothing sells. */
export const daysOfCover = (available: number, velocity: number): number | null =>
  velocity > 0 ? available / velocity : null;

/**
 * A product is suggested when its available stock plus what is already on order is at or below the reorder point (a
 * draft counts as on order, so it is not suggested twice), and it either moved in the window or its available stock is
 * at or below the minimum stock (the low-stock rule of BR-REPORT-002).
 */
export const isSuggested = (
  position: Pick<ProductStockPosition, "onHand" | "reserved" | "dispensedQuantity" | "inboundQuantity">,
  reorder: number,
  minimum: number,
): boolean => {
  const available = position.onHand - position.reserved;
  const covered = settle(available + position.inboundQuantity) <= settle(reorder);
  const moved = position.dispensedQuantity > 0;
  return covered && (moved || settle(available) <= settle(minimum));
};

/** The suggestion for one position, or undefined when the product is not to be reordered. */
export const suggestReplenishment = (
  position: ProductStockPosition,
  lead: LeadTime,
  params: ReplenishmentParams,
): ReplenishmentSuggestion | undefined => {
  const velocity = dailyVelocity(position.dispensedQuantity, params.windowDays);
  const minimum = minimumStock(velocity, params.safetyDays);
  const reorder = reorderPoint(velocity, lead.leadTimeDays, minimum);
  if (!isSuggested(position, reorder, minimum)) return undefined;
  const available = position.onHand - position.reserved;
  const target = targetStock(velocity, lead.leadTimeDays, params.coverDays, minimum);
  // Stock plus what is on order already reaches the target: nothing is left to order, so the row is not a suggestion.
  if (settle(target - available - position.inboundQuantity) <= 0) return undefined;
  return {
    productId: position.productId,
    supplierId: position.supplierId,
    dailyVelocity: velocity,
    dispensedQuantity: position.dispensedQuantity,
    onHand: position.onHand,
    reserved: position.reserved,
    available,
    inboundQuantity: position.inboundQuantity,
    minimumStock: minimum,
    leadTimeDays: lead.leadTimeDays,
    leadTimeSource: lead.leadTimeSource,
    sampleCount: lead.sampleCount,
    reorderPoint: reorder,
    targetStock: target,
    suggestedQuantity: suggestedQuantity(target, available, position.inboundQuantity),
    daysOfCover: daysOfCover(available, velocity),
  };
};

/**
 * The suggestions for a site, in the order of the positions. A product without a supplier, or whose supplier has no
 * sample in the history, takes the default lead time.
 */
export const replenishmentSuggestions = (input: {
  positions: readonly ProductStockPosition[];
  leadTimeSamples: readonly LeadTimeSample[];
  params: ReplenishmentParams;
}): ReplenishmentSuggestion[] => {
  const samplesBySupplier = new Map<string, number[]>();
  for (const sample of input.leadTimeSamples) {
    const samples = samplesBySupplier.get(sample.supplierId) ?? [];
    samples.push(sample.days);
    samplesBySupplier.set(sample.supplierId, samples);
  }
  return input.positions.flatMap((position) => {
    const samples = position.supplierId === null ? [] : (samplesBySupplier.get(position.supplierId) ?? []);
    const suggestion = suggestReplenishment(
      position,
      leadTime(samples, input.params.defaultLeadTimeDays),
      input.params,
    );
    return suggestion ? [suggestion] : [];
  });
};
