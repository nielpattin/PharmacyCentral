import type { Logger } from "../../../logger.ts";
import type { SalesRepository } from "../../sales-repository.ts";
import type { InventoryReservations } from "../infrastructure/inventory-reservations.ts";

/** A QR order is abandoned when the transfer does not arrive in this time. */
export const QR_ORDER_TTL_MS = 30 * 60 * 1000;
/** An order paid on delivery has nothing to pay online, so it waits longer for a member of staff to act on it. */
export const CASH_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const RELEASE_BATCH_SIZE = 50;
/**
 * An order is only checked against inventory once it is older than the longest a placement can still be in flight
 * (inventory's own timeout is 5 s), and only if it is younger than the lookback: each order is checked about once,
 * and a restart still covers the orders a crash left behind.
 */
export const RECONCILE_GRACE_MS = 2 * 60 * 1000;
export const RECONCILE_LOOKBACK_MS = 10 * 60 * 1000;
/** An Idempotency-Key replays the order it created for this long; after that the same key places a new order. */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The stock side of an online order. An order holds stock in inventory-service from the moment it is placed until it
 * is cancelled (the hold is given back) or handed over (the goods leave the shelf). The order id is the reservation
 * id, and `orders.stock_hold` records whether inventory may still hold something for the order, which is what lets
 * a failure between two steps be repaired later: a cancelled order that still says `held` is released by a sweep.
 */
export class OrderStock {
  /** Orders created before this moment have been checked against inventory by this process. */
  private reconciledUpTo: Date | undefined;

  public constructor(
    private readonly repository: SalesRepository,
    private readonly inventory: InventoryReservations,
    private readonly logger: Logger,
  ) {}

  /**
   * Holds the stock of a freshly placed order. When inventory cannot hold it, the order is cancelled before the
   * failure is rethrown, so a shopper never keeps an order whose goods nobody set aside.
   */
  public async hold(
    order: { id: string; selectedStoreId: string },
    lines: Array<{ productId: string; quantity: number }>,
  ): Promise<void> {
    try {
      await this.inventory.reserve(order.id, order.selectedStoreId, lines);
    } catch (error) {
      await this.repository.transitionOrder(order.id, "Cancelled");
      // The reserve may have succeeded without the answer arriving, so whatever it held is given back too.
      await this.releaseQuietly(order.id);
      throw error;
    }
  }

  /** Gives the hold of an order back. A repeat does nothing, and an order that held nothing is left alone. */
  public async release(orderId: string): Promise<void> {
    const order = await this.repository.getOrder(orderId);
    if (order?.stockHold !== "held") return;
    await this.inventory.release(orderId);
    await this.repository.endStockHold(orderId, "released");
  }

  /** A failed release is repaired by the sweep, because the order still says `held`. */
  public async releaseQuietly(orderId: string): Promise<void> {
    try {
      await this.release(orderId);
    } catch (error) {
      this.logger.warn({ error, orderId }, "order stock could not be released, the sweep will retry");
    }
  }

  /**
   * A refunded order that was not handed over will not happen: it is cancelled and its stock freed. An order that
   * is already out or collected is left to the staff, and one that is already cancelled only has its hold checked.
   */
  public async cancelRefunded(order: { id: string; status: string }): Promise<void> {
    if (
      order.status === "Pending" ||
      order.status === "Confirmed" ||
      order.status === "Preparing" ||
      order.status === "Ready"
    )
      await this.repository.transitionOrder(order.id, "Cancelled");
    else if (order.status !== "Cancelled") return;
    await this.releaseQuietly(order.id);
  }

  /** The goods of the order leave the shelf. A repeat does nothing, and an order that held nothing is left alone. */
  public async consume(orderId: string): Promise<void> {
    const order = await this.repository.getOrder(orderId);
    if (order?.stockHold !== "held") return;
    await this.inventory.consume(orderId, orderId);
    await this.repository.endStockHold(orderId, "consumed");
  }

  /**
   * Cancels the orders nobody paid for in time, then gives back the hold of every cancelled order that kept one. It
   * also forgets the Idempotency-Keys older than their replay window.
   */
  public async sweep(now = new Date()): Promise<void> {
    const expired = await this.repository.cancelExpiredUnpaidOrders(now, QR_ORDER_TTL_MS, CASH_ORDER_TTL_MS);
    if (expired.length > 0) this.logger.info({ orders: expired.length }, "unpaid orders expired");
    for (const { id } of await this.repository.listCancelledOrdersWithHold(RELEASE_BATCH_SIZE))
      await this.releaseQuietly(id);
    try {
      await this.reconcile(now);
    } catch (error) {
      this.logger.warn({ error }, "order stock reconciliation failed, the next sweep will retry");
    }
    await this.repository.deleteOrderIdempotencyKeysCreatedBefore(new Date(now.getTime() - IDEMPOTENCY_KEY_TTL_MS));
  }

  /**
   * Checks each order of the window against inventory, once the window is old enough for any placement to have
   * finished. Two things can be wrong, and both are repaired here:
   * - An unpaid order says `held` while inventory holds nothing, because the process died before the reservation. It
   *   is cancelled, the same outcome as a refused reservation, so a shopper cannot pay for goods nobody set aside.
   * - A cancelled order was released before its reservation arrived (a late answer after a timed-out hold), which left
   *   an active hold that no other sweep reaches. That active hold is released.
   * The window moves forward only after every order in it was checked.
   */
  public async reconcile(now = new Date()): Promise<void> {
    const to = new Date(now.getTime() - RECONCILE_GRACE_MS);
    const from = this.reconciledUpTo ?? new Date(now.getTime() - RECONCILE_LOOKBACK_MS);
    if (from >= to) return;
    const candidates = await this.repository.listOrdersToReconcileCreatedBetween(from, to, RELEASE_BATCH_SIZE);
    for (const order of candidates) {
      const reservation = await this.inventory.reservationStatus(order.id);
      if (order.status === "Cancelled") {
        if (reservation !== "active") continue;
        await this.inventory.release(order.id);
        await this.repository.endStockHold(order.id, "released");
        this.logger.warn({ orderId: order.id }, "cancelled order had a late stock reservation, it was released");
        continue;
      }
      if (reservation !== undefined) continue;
      if (await this.repository.cancelUnpaidOrder(order.id, now)) {
        this.logger.warn({ orderId: order.id }, "unpaid order had no stock reservation and was cancelled");
        await this.releaseQuietly(order.id);
      }
    }
    const last = candidates[candidates.length - 1];
    this.reconciledUpTo = candidates.length === RELEASE_BATCH_SIZE && last ? last.createdAt : to;
  }
}

/** Runs {@link OrderStock.sweep} on a fixed cadence; a tick that finds the previous sweep still running is dropped. */
export class OrderStockSweeper {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;

  public constructor(
    private readonly orderStock: OrderStock,
    private readonly logger: Logger,
  ) {}

  public start(): void {
    this.timer = setInterval(() => void this.run(), SWEEP_INTERVAL_MS);
    void this.run();
  }

  public close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async run(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.orderStock.sweep();
    } catch (error) {
      this.logger.error({ error }, "order stock sweep failed");
    } finally {
      this.inFlight = false;
    }
  }
}
