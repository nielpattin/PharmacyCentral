/**
 * The transfer-suggestion formulas. A site that holds more cover than it needs offers stock to a site that is running
 * out, as long as the destination can sell the quantity before the stock expires. Pure: the repository supplies the
 * sellable stock and the dispensed quantity per site, and the caller supplies the clock. Quantities are base units;
 * durations are days.
 */

/** The sales window that gives a site its daily velocity. */
export const TRANSFER_WINDOW_DAYS = 30;
/** A source keeps this many days of its own cover; only the stock above it may leave. */
export const TRANSFER_KEEP_COVER_DAYS = 45;
/** A destination below this many days of cover is short enough to receive stock. */
export const TRANSFER_TRIGGER_COVER_DAYS = 14;
/** A transfer fills the destination back to this many days of cover. */
export const TRANSFER_TARGET_COVER_DAYS = 30;

const MILLISECONDS_PER_DAY = 86_400_000;

/** Rounds to six decimals, which removes float noise before a floor or a comparison. */
const settle = (value: number): number => Math.round(value * 1e6) / 1e6;

/** Whole days from one `YYYY-MM-DD` date to another; negative when the second is in the past. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLISECONDS_PER_DAY);

/** One product's position at one site, from the sellable stock and the sales ledger. */
export type TransferPosition = {
  productId: string;
  siteId: string;
  /** Sellable on-hand minus reserved. Never negative. */
  available: number;
  /** Base units dispensed at the site in the window. */
  dispensedQuantity: number;
  /** Earliest expiry date (`YYYY-MM-DD`) of the sellable batches that hold the stock; null with no sellable stock. */
  earliestExpiry: string | null;
};

export type TransferSuggestion = {
  productId: string;
  sourceSiteId: string;
  destinationSiteId: string;
  quantity: number;
  sourceAvailable: number;
  /** Null when the source did not sell in the window, so its cover is unbounded. */
  sourceDaysOfCover: number | null;
  destinationAvailable: number;
  destinationDaysOfCover: number;
  destinationDailyVelocity: number;
  earliestExpiry: string;
  daysToExpiry: number;
  /** True when expiry, not the destination's need, is what limits the quantity. */
  cappedByExpiry: boolean;
};

type SiteState = {
  siteId: string;
  available: number;
  velocity: number;
  cover: number | null;
  earliestExpiry: string | null;
  /** Units above the cover a source keeps. */
  surplus: number;
  /** Units the destination needs to reach its target cover. */
  need: number;
};

const stateOf = (position: TransferPosition, windowDays: number): SiteState => {
  const available = Math.max(0, settle(position.available));
  const velocity = Math.max(0, position.dispensedQuantity) / windowDays;
  const cover = velocity > 0 ? available / velocity : null;
  const surplus = cover === null ? available : Math.max(0, available - velocity * TRANSFER_KEEP_COVER_DAYS);
  const need =
    cover !== null && cover < TRANSFER_TRIGGER_COVER_DAYS
      ? Math.max(0, velocity * TRANSFER_TARGET_COVER_DAYS - available)
      : 0;
  return {
    siteId: position.siteId,
    available,
    velocity,
    cover,
    earliestExpiry: position.earliestExpiry,
    surplus,
    need,
  };
};

/**
 * The transfers the chain should make: every destination under the trigger cover takes stock from the product's sites
 * with a surplus, most urgent destination first. A source keeps its own cover, a destination is filled to its target,
 * and the quantity is never more than the destination can sell before the source stock expires. Whole base units only;
 * a quantity that rounds down to nothing is not suggested.
 */
export const transferSuggestions = (input: {
  positions: readonly TransferPosition[];
  windowDays: number;
  today: string;
}): TransferSuggestion[] => {
  if (!(input.windowDays > 0)) return [];

  const byProduct = new Map<string, SiteState[]>();
  for (const position of input.positions) {
    const states = byProduct.get(position.productId) ?? [];
    states.push(stateOf(position, input.windowDays));
    byProduct.set(position.productId, states);
  }

  const suggestions: TransferSuggestion[] = [];
  for (const [productId, states] of byProduct) {
    const sources = states
      .filter((state) => state.earliestExpiry !== null && state.surplus >= 1)
      .sort((left, right) => {
        // No sales at the source means unbounded cover, so it offers stock first.
        if (left.cover === null && right.cover !== null) return -1;
        if (left.cover !== null && right.cover === null) return 1;
        if (left.cover !== null && right.cover !== null && left.cover !== right.cover) return right.cover - left.cover;
        return right.surplus - left.surplus || left.siteId.localeCompare(right.siteId);
      });
    const destinations = states
      .filter((state) => state.need >= 1)
      .sort((left, right) => (left.cover ?? 0) - (right.cover ?? 0) || left.siteId.localeCompare(right.siteId));

    for (const destination of destinations) {
      let remaining = destination.need;
      for (const source of sources) {
        if (remaining < 1) break;
        if (source.siteId === destination.siteId || source.surplus < 1 || source.earliestExpiry === null) continue;
        const daysToExpiry = daysBetween(input.today, source.earliestExpiry);
        // Stock that expires today cannot be sold at the destination, so moving it buys nothing.
        if (daysToExpiry <= 0) continue;
        const room = Math.floor(settle(Math.min(source.surplus, remaining)));
        const sellableBeforeExpiry = destination.velocity * daysToExpiry;
        const quantity = Math.floor(settle(Math.min(source.surplus, remaining, sellableBeforeExpiry)));
        if (quantity < 1) continue;
        suggestions.push({
          productId,
          sourceSiteId: source.siteId,
          destinationSiteId: destination.siteId,
          quantity,
          sourceAvailable: source.available,
          sourceDaysOfCover: source.cover,
          destinationAvailable: destination.available,
          destinationDaysOfCover: destination.cover ?? 0,
          destinationDailyVelocity: destination.velocity,
          earliestExpiry: source.earliestExpiry,
          daysToExpiry,
          cappedByExpiry: quantity < room,
        });
        source.surplus = settle(source.surplus - quantity);
        remaining = settle(remaining - quantity);
      }
    }
  }

  return suggestions.sort(
    (left, right) =>
      left.destinationDaysOfCover - right.destinationDaysOfCover ||
      right.quantity - left.quantity ||
      left.productId.localeCompare(right.productId) ||
      left.sourceSiteId.localeCompare(right.sourceSiteId),
  );
};
