import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { CustomerFirstPaid, SalesDocument, SalesTarget } from "../contracts/sales.ts";
import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import {
  afterCursor,
  clampLimit,
  containsPattern,
  createdAtSortKey,
  toPage,
} from "../shared/infrastructure/keyset-page.ts";
import type { Page, PageCursor } from "../shared/page-cursor.ts";
import {
  cartLines,
  carts,
  deliveryAddresses,
  orderDeliverySnapshots,
  orderLines,
  orders,
  outboxMessages,
  prescriptionLines,
  prescriptions,
  salesTargets,
  idempotencyRecords,
  orderIdempotencyKeys,
} from "../shared/infrastructure/schema.ts";
import { transitionOrder, type OrderStatus } from "./orders/domain/order-status.ts";
import { transitionPrescription, type PrescriptionStatus } from "./prescriptions/domain/prescription-status.ts";

/** The invoice states the payment service publishes, mirrored onto the order. */
type PaymentStatus = "Pending" | "Paid" | "Failed" | "Refunded";

type OrderLineInput = {
  productId: string;
  productUnitId: string;
  productNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
};

type DeliverySnapshotInput = Omit<typeof orderDeliverySnapshots.$inferInsert, "orderId" | "createdAt">;

/** A dispense the prescription cannot take: it is closed, names a line it lacks, or exceeds what was prescribed. */
export class PrescriptionDispenseError extends Error {}

/**
 * The shopper's Idempotency-Key already belongs to an order. The order insert that raised it is rolled back, so the
 * caller answers with the order that owns the key instead.
 */
export class IdempotencyKeyInUseError extends Error {
  public constructor() {
    super("Idempotency-Key already belongs to an order");
    this.name = "IdempotencyKeyInUseError";
  }
}

/** A prescription header with the lines it was written for, as the prescription list answers it. */
export type PrescriptionWithLines = typeof prescriptions.$inferSelect & {
  lines: Array<typeof prescriptionLines.$inferSelect>;
};

/** The goods a dispense takes off the shelf, handed to inventory while the prescription row is still locked. */
export type PrescriptionStockDispense = {
  prescriptionId: string;
  reservationId: string | null;
  siteId: string;
  storageLocationId: string;
  lines: Array<{ productId: string; productBatchId: string; quantity: number }>;
};

export class SalesRepository {
  public constructor(private readonly database: SalesDatabase) {}

  public async getCart(customerId: string) {
    const cart = await this.findCart(this.database.db, customerId);
    if (!cart) return undefined;
    return this.withCartLines(this.database.db, cart);
  }

  public async getOrCreateCart(customerId: string) {
    const existing = await this.getCart(customerId);
    if (existing) return existing;
    const [cart] = await this.database.db
      .insert(carts)
      .values({ customerId })
      .onConflictDoNothing({ target: carts.customerId })
      .returning();
    if (cart) return { ...cart, lines: [] };

    const concurrentCart = await this.getCart(customerId);
    if (!concurrentCart) throw new Error("Cart insert did not return a row");
    return concurrentCart;
  }

  public async addCartLine(customerId: string, input: { productId: string; productUnitId: string; quantity: number }) {
    const cart = await this.getOrCreateCart(customerId);
    await this.database.db.transaction(async (transaction) => {
      const current = (
        await transaction
          .select()
          .from(cartLines)
          .where(
            and(
              eq(cartLines.cartId, cart.id),
              eq(cartLines.productId, input.productId),
              eq(cartLines.productUnitId, input.productUnitId),
            ),
          )
          .limit(1)
      )[0];
      if (current) {
        await transaction
          .update(cartLines)
          .set({ quantity: String(Number(current.quantity) + input.quantity) })
          .where(eq(cartLines.id, current.id));
      } else {
        await transaction.insert(cartLines).values({
          cartId: cart.id,
          productId: input.productId,
          productUnitId: input.productUnitId,
          quantity: String(input.quantity),
        });
      }
      await transaction.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    });
    return this.getCart(customerId);
  }

  /** The ticked lines of the cart, the ones the next order is made from (BR-CART-002). */
  public async getSelectedCartLines(customerId: string) {
    const cart = await this.getCart(customerId);
    return (cart?.lines ?? [])
      .filter((line) => line.selected)
      .map((line) => ({
        id: line.id,
        productId: line.productId,
        productUnitId: line.productUnitId,
        quantity: Number(line.quantity),
      }));
  }

  /**
   * Empties the cart, or removes only `lineIds` when given. The ids are scoped to this cart, so an id from another
   * shopper's cart matches nothing. Removing just the lines an order was made from keeps the rest for a later order.
   */
  public async clearCart(customerId: string, lineIds?: string[]) {
    const cart = await this.getCart(customerId);
    if (!cart) return undefined;
    await this.database.db
      .delete(cartLines)
      .where(
        lineIds ? and(eq(cartLines.cartId, cart.id), inArray(cartLines.id, lineIds)) : eq(cartLines.cartId, cart.id),
      );
    await this.database.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return this.getCart(customerId);
  }

  public async updateCartLine(customerId: string, lineId: string, quantity: number) {
    const cart = await this.getCart(customerId);
    if (!cart) return undefined;
    if (quantity === 0)
      await this.database.db.delete(cartLines).where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
    else
      await this.database.db
        .update(cartLines)
        .set({ quantity: String(quantity) })
        .where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
    return this.getCart(customerId);
  }

  /**
   * Ticks or unticks cart lines for the next order: the named `lineIds`, or every line when none are named. Ids are
   * scoped to this cart, so an id from another shopper's cart matches nothing. The tick lives on the server so it
   * survives a reload and follows the shopper to another device.
   */
  public async setCartSelection(customerId: string, selected: boolean, lineIds?: string[]) {
    const cart = await this.getCart(customerId);
    if (!cart) return undefined;
    await this.database.db
      .update(cartLines)
      .set({ selected })
      .where(
        lineIds ? and(eq(cartLines.cartId, cart.id), inArray(cartLines.id, lineIds)) : eq(cartLines.cartId, cart.id),
      );
    return this.getCart(customerId);
  }

  /**
   * Adds the signed-out cart to the account cart in one transaction. Lines for the same product and unit are summed
   * first, so the request holds one line per product and unit. An account line that already exists keeps its tick and
   * takes the quantity; any other line is inserted with the tick it was sent with. The first sent line decides the
   * tick of a repeated product and unit.
   */
  public async mergeLocalCart(
    customerId: string,
    lines: Array<{ productId: string; productUnitId: string; quantity: number; selected: boolean }>,
  ) {
    const cart = await this.getOrCreateCart(customerId);
    const summed = new Map<string, (typeof lines)[number]>();
    for (const line of lines) {
      const key = `${line.productId}:${line.productUnitId}`;
      const existing = summed.get(key);
      if (existing) existing.quantity += line.quantity;
      else summed.set(key, { ...line });
    }
    await this.database.db.transaction(async (transaction) => {
      for (const line of summed.values()) {
        const current = (
          await transaction
            .select()
            .from(cartLines)
            .where(
              and(
                eq(cartLines.cartId, cart.id),
                eq(cartLines.productId, line.productId),
                eq(cartLines.productUnitId, line.productUnitId),
              ),
            )
            .limit(1)
        )[0];
        if (current) {
          await transaction
            .update(cartLines)
            .set({ quantity: String(Number(current.quantity) + line.quantity) })
            .where(eq(cartLines.id, current.id));
        } else {
          await transaction.insert(cartLines).values({
            cartId: cart.id,
            productId: line.productId,
            productUnitId: line.productUnitId,
            quantity: String(line.quantity),
            selected: line.selected,
          });
        }
      }
      await transaction.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    });
    return this.getCart(customerId);
  }

  public async createOrder(input: {
    customerId: string;
    selectedStoreId: string;
    fulfillmentType: "pickup" | "delivery";
    subtotal: number;
    deliveryFee: number;
    currency: string;
    paymentMethod?: string | undefined;
    lines: OrderLineInput[];
    delivery?: DeliverySnapshotInput;
    /** The shopper's Idempotency-Key and the fingerprint of the request it came with. */
    idempotency?: { key: string; requestHash: string } | undefined;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const [order] = await transaction
        .insert(orders)
        .values({
          customerId: input.customerId,
          selectedStoreId: input.selectedStoreId,
          fulfillmentType: input.fulfillmentType,
          subtotal: String(input.subtotal),
          deliveryFee: String(input.deliveryFee),
          currency: input.currency,
          paymentMethod: input.paymentMethod ?? null,
          // Inventory is asked to hold the stock right after this insert; `held` is what lets a sweep give a hold
          // back even when the process dies between the two steps.
          stockHold: "held",
        })
        .returning();
      if (!order) throw new Error("Order insert did not return a row");
      await transaction.insert(orderLines).values(
        input.lines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          productUnitId: line.productUnitId,
          productNameSnapshot: line.productNameSnapshot,
          unitPriceSnapshot: String(line.unitPriceSnapshot),
          quantity: String(line.quantity),
        })),
      );
      if (input.delivery)
        await transaction.insert(orderDeliverySnapshots).values({ ...input.delivery, orderId: order.id });
      if (input.idempotency) {
        // Concurrent duplicates race on this unique key: the loser gets no row back, and rolls its order back too.
        const claimed = await transaction
          .insert(orderIdempotencyKeys)
          .values({
            customerId: input.customerId,
            key: input.idempotency.key,
            requestHash: input.idempotency.requestHash,
            orderId: order.id,
          })
          .onConflictDoNothing({ target: [orderIdempotencyKeys.customerId, orderIdempotencyKeys.key] })
          .returning({ orderId: orderIdempotencyKeys.orderId });
        if (claimed.length === 0) throw new IdempotencyKeyInUseError();
      }
      await transaction.insert(outboxMessages).values({
        eventType: "sales.order.created.v1",
        aggregateId: order.id,
        payload: JSON.stringify({
          orderId: order.id,
          customerId: order.customerId,
          ...(order.customerId ? { actorId: order.customerId } : {}),
          selectedStoreId: order.selectedStoreId,
          fulfillmentType: order.fulfillmentType,
        }),
      });
      return order;
    });
  }

  /** The order a shopper's Idempotency-Key was used for, with the fingerprint of the request it came with. */
  public async getOrderIdempotencyKey(customerId: string, key: string) {
    const [record] = await this.database.db
      .select({ requestHash: orderIdempotencyKeys.requestHash, orderId: orderIdempotencyKeys.orderId })
      .from(orderIdempotencyKeys)
      .where(and(eq(orderIdempotencyKeys.customerId, customerId), eq(orderIdempotencyKeys.key, key)))
      .limit(1);
    return record;
  }

  /**
   * Forgets the key of an order that was refused for stock, so a retry with the same key places a new order rather
   * than replaying a cancelled one. Only the record of that order is removed.
   */
  public async deleteOrderIdempotencyKey(customerId: string, key: string, orderId: string): Promise<void> {
    await this.database.db
      .delete(orderIdempotencyKeys)
      .where(
        and(
          eq(orderIdempotencyKeys.customerId, customerId),
          eq(orderIdempotencyKeys.key, key),
          eq(orderIdempotencyKeys.orderId, orderId),
        ),
      );
  }

  /** Forgets the keys created before `cutoff`. A key that is older than the replay window places a new order. */
  public async deleteOrderIdempotencyKeysCreatedBefore(cutoff: Date): Promise<void> {
    await this.database.db.delete(orderIdempotencyKeys).where(lt(orderIdempotencyKeys.createdAt, cutoff));
  }

  public async listOrders(input: {
    customerId?: string | undefined;
    status?: string | undefined;
    paymentStatus?: string | undefined;
    /** The sites an order may belong to; an empty list matches nothing. Omitted means no site restriction. */
    siteIds?: string[] | undefined;
    q?: string | undefined;
    after?: PageCursor | undefined;
    limit: number;
  }): Promise<Page<typeof orders.$inferSelect>> {
    const filters = [
      input.customerId ? eq(orders.customerId, input.customerId) : undefined,
      input.status ? eq(orders.status, input.status) : undefined,
      input.paymentStatus ? eq(orders.paymentStatus, input.paymentStatus) : undefined,
      input.siteIds ? inArray(orders.selectedStoreId, input.siteIds) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const limit = clampLimit(input.limit);
    const fetched = await this.database.db
      .select({ ...getTableColumns(orders), sortKey: createdAtSortKey(orders.createdAt) })
      .from(orders)
      .where(
        and(
          ...filters,
          // The order id is the only identifier sales-service stores: customer name, phone and order number live elsewhere.
          input.q ? sql`(${orders.id})::text ilike ${containsPattern(input.q)}` : undefined,
          afterCursor(orders.createdAt, orders.id, input.after),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);
    return toPage(fetched, limit);
  }

  public async getOrder(id: string) {
    const order = (await this.database.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
    if (!order) return undefined;
    return {
      ...order,
      lines: await this.database.db.select().from(orderLines).where(eq(orderLines.orderId, id)),
      delivery: (
        await this.database.db
          .select()
          .from(orderDeliverySnapshots)
          .where(eq(orderDeliverySnapshots.orderId, id))
          .limit(1)
      )[0],
    };
  }

  /** `actorId` is the member of staff or shopper who made the move; the sweepers and the payment webhook leave it out. */
  public async transitionOrder(id: string, next: OrderStatus, actorId?: string) {
    const current = (await this.database.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
    if (!current) return undefined;
    transitionOrder(current.status as OrderStatus, next);
    const [order] = await this.database.db
      .update(orders)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    if (order)
      await this.appendEvent("sales.order.status-changed.v1", order.id, {
        orderId: order.id,
        status: order.status,
        ...(actorId ? { actorId } : {}),
      });
    return order;
  }

  /** Ends the stock hold of an order, once: `false` when the order no longer held stock. */
  public async endStockHold(id: string, to: "released" | "consumed"): Promise<boolean> {
    const moved = await this.database.db
      .update(orders)
      .set({ stockHold: to, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.stockHold, "held")))
      .returning({ id: orders.id });
    return moved.length > 0;
  }

  /** Cancelled orders that still owe inventory a release, oldest first. */
  public async listCancelledOrdersWithHold(limit: number) {
    return this.database.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, "Cancelled"), eq(orders.stockHold, "held")))
      .orderBy(asc(orders.updatedAt))
      .limit(limit);
  }

  /**
   * Orders created in [from, to) whose stock may still be held by inventory, oldest first: unpaid orders that say
   * `held`, and cancelled orders whose hold was not consumed. Reconciliation asks inventory about each one. An unpaid
   * order whose process died before the reservation says `held` while inventory holds nothing; a cancelled order can
   * have a reservation that arrived after its release.
   */
  public async listOrdersToReconcileCreatedBetween(from: Date, to: Date, limit: number) {
    return this.database.db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        status: orders.status,
      })
      .from(orders)
      .where(
        and(
          gte(orders.createdAt, from),
          lt(orders.createdAt, to),
          or(
            and(eq(orders.status, "Pending"), eq(orders.paymentStatus, "Pending"), eq(orders.stockHold, "held")),
            and(eq(orders.status, "Cancelled"), inArray(orders.stockHold, ["held", "released"])),
          ),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(limit);
  }

  /**
   * Cancels one unpaid order whose stock was never held. The update is conditional on the order still being unpaid,
   * so a payment that lands meanwhile is never cancelled; the status event commits with the status. `false` when the
   * order was no longer unpaid.
   */
  public async cancelUnpaidOrder(id: string, now: Date): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const [cancelled] = await transaction
        .update(orders)
        .set({ status: "Cancelled", updatedAt: now })
        .where(and(eq(orders.id, id), eq(orders.status, "Pending"), eq(orders.paymentStatus, "Pending")))
        .returning({ id: orders.id });
      if (!cancelled) return false;
      await transaction.insert(outboxMessages).values({
        eventType: "sales.order.status-changed.v1",
        aggregateId: id,
        payload: JSON.stringify({ orderId: id, status: "Cancelled" }),
      });
      return true;
    });
  }

  /**
   * Cancels the orders that held stock and were never paid. An order paid by QR waits `qrTtlMs`, one paid on
   * delivery waits `cashTtlMs`, and an order that names no method is treated as a QR order. The update is
   * conditional on the order still being unpaid, so a payment that lands during the sweep is never cancelled, and
   * the status event commits with the status.
   */
  public async cancelExpiredUnpaidOrders(now: Date, qrTtlMs: number, cashTtlMs: number): Promise<string[]> {
    const qrCutoff = new Date(now.getTime() - qrTtlMs);
    const cashCutoff = new Date(now.getTime() - cashTtlMs);
    return this.database.db.transaction(async (transaction) => {
      const cancelled = await transaction
        .update(orders)
        .set({ status: "Cancelled", updatedAt: now })
        .where(
          and(
            eq(orders.status, "Pending"),
            eq(orders.paymentStatus, "Pending"),
            eq(orders.stockHold, "held"),
            or(
              and(sql`${orders.paymentMethod} is distinct from 'cash_on_delivery'`, lt(orders.createdAt, qrCutoff)),
              and(eq(orders.paymentMethod, "cash_on_delivery"), lt(orders.createdAt, cashCutoff)),
            ),
          ),
        )
        .returning({ id: orders.id });
      for (const { id } of cancelled)
        await transaction.insert(outboxMessages).values({
          eventType: "sales.order.status-changed.v1",
          aggregateId: id,
          payload: JSON.stringify({ orderId: id, status: "Cancelled" }),
        });
      return cancelled.map(({ id }) => id);
    });
  }

  /**
   * Money is the payment service's authority, the order is ours. No member of staff accepts an online order by hand,
   * so receiving the full amount is what confirms it; an order the pharmacy has already moved past Pending keeps
   * that status.
   */
  public async applyPaymentStatus(id: string, status: PaymentStatus) {
    const current = (await this.database.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
    if (!current) return undefined;
    const confirming = status === "Paid" && current.status === "Pending";
    const [order] = await this.database.db
      .update(orders)
      .set({
        paymentStatus: status,
        // A refund keeps the first payment: the buyer existed before it, and the customer split must not forget them.
        ...(status === "Paid" ? { paidAt: sql`coalesce(${orders.paidAt}, now())` } : {}),
        ...(confirming ? { status: transitionOrder("Pending", "Confirmed") } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (order && confirming)
      await this.appendEvent("sales.order.status-changed.v1", order.id, { orderId: order.id, status: order.status });
    return order;
  }

  /** Marks when a counter prescription was first paid; a refund does not clear the date. */
  public async applyPrescriptionPaidAt(id: string) {
    const [prescription] = await this.database.db
      .update(prescriptions)
      .set({ paidAt: sql`coalesce(${prescriptions.paidAt}, now())`, updatedAt: new Date() })
      .where(eq(prescriptions.id, id))
      .returning();
    return prescription;
  }

  public async listDeliveryAddresses(customerId: string) {
    return this.database.db
      .select()
      .from(deliveryAddresses)
      .where(eq(deliveryAddresses.customerId, customerId))
      .orderBy(desc(deliveryAddresses.updatedAt));
  }

  /**
   * Stores one of the shopper's delivery points. A shopper's very first address becomes their default
   * without being asked: there is nothing to compare it against yet, and a shopper with a saved address
   * but no default is a state the UI and the checkout preselection both have to special-case.
   */
  public async createDeliveryAddress(input: {
    customerId: string;
    label: string;
    latitude: number;
    longitude: number;
    providerResolvedAddress: string;
    addressNote?: string | null | undefined;
    isDefault?: boolean | undefined;
  }) {
    return this.database.db.transaction(async (transaction) => {
      // Only one default may exist per shopper, so a newly created default displaces the old one in one transaction.
      if (input.isDefault === true) {
        await transaction
          .update(deliveryAddresses)
          .set({ isDefault: false })
          .where(and(eq(deliveryAddresses.customerId, input.customerId), eq(deliveryAddresses.isDefault, true)));
      }
      const [existing] = await transaction
        .select({ id: deliveryAddresses.id })
        .from(deliveryAddresses)
        .where(eq(deliveryAddresses.customerId, input.customerId))
        .limit(1);
      const isDefault = input.isDefault === true || existing === undefined;
      const [address] = await transaction
        .insert(deliveryAddresses)
        .values({
          ...input,
          latitude: String(input.latitude),
          longitude: String(input.longitude),
          addressNote: input.addressNote ?? null,
          isDefault,
        })
        .returning();
      return address;
    });
  }

  /**
   * Removes one of the shopper's own addresses. Deleting the default would otherwise leave them with no
   * default at all, which is a state the account page and the checkout preselection both cannot render
   * sensibly, so the most recently updated survivor takes over in the same transaction.
   */
  public async deleteDeliveryAddress(customerId: string, id: string) {
    return this.database.db.transaction(async (transaction) => {
      const [address] = await transaction
        .delete(deliveryAddresses)
        .where(and(eq(deliveryAddresses.id, id), eq(deliveryAddresses.customerId, customerId)))
        .returning();
      if (!address) return undefined;
      if (address.isDefault) {
        const [survivor] = await transaction
          .select({ id: deliveryAddresses.id })
          .from(deliveryAddresses)
          .where(eq(deliveryAddresses.customerId, customerId))
          .orderBy(desc(deliveryAddresses.updatedAt))
          .limit(1);
        if (survivor) {
          await transaction
            .update(deliveryAddresses)
            .set({ isDefault: true })
            .where(eq(deliveryAddresses.id, survivor.id));
        }
      }
      return address;
    });
  }

  /**
   * Applies a partial edit to one of the shopper's own addresses. Promoting a row to default clears the previous one
   * in the same transaction, so the partial unique index never sees two defaults for a customer. Demoting the last
   * default would leave the shopper with none, so the flag moves to the most recently updated survivor.
   */
  public async updateDeliveryAddress(
    customerId: string,
    id: string,
    input: {
      label?: string | undefined;
      latitude?: number | undefined;
      longitude?: number | undefined;
      providerResolvedAddress?: string | undefined;
      addressNote?: string | null | undefined;
      isDefault?: boolean | undefined;
    },
  ) {
    return this.database.db.transaction(async (transaction) => {
      if (input.isDefault === true) {
        await transaction
          .update(deliveryAddresses)
          .set({ isDefault: false })
          .where(and(eq(deliveryAddresses.customerId, customerId), ne(deliveryAddresses.id, id)));
      }

      const [address] = await transaction
        .update(deliveryAddresses)
        .set({
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.latitude !== undefined ? { latitude: String(input.latitude) } : {}),
          ...(input.longitude !== undefined ? { longitude: String(input.longitude) } : {}),
          ...(input.providerResolvedAddress !== undefined
            ? { providerResolvedAddress: input.providerResolvedAddress }
            : {}),
          ...(input.addressNote !== undefined ? { addressNote: input.addressNote } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(deliveryAddresses.id, id), eq(deliveryAddresses.customerId, customerId)))
        .returning();
      if (!address) return undefined;

      if (input.isDefault === false) {
        const [survivor] = await transaction
          .select({ id: deliveryAddresses.id })
          .from(deliveryAddresses)
          .where(and(eq(deliveryAddresses.customerId, customerId), ne(deliveryAddresses.id, id)))
          .orderBy(desc(deliveryAddresses.updatedAt))
          .limit(1);
        if (survivor) {
          await transaction
            .update(deliveryAddresses)
            .set({ isDefault: true })
            .where(eq(deliveryAddresses.id, survivor.id));
        }
      }
      return address;
    });
  }

  public async createPrescription(input: {
    siteId: string;
    storageLocationId: string;
    patientName: string;
    patientPhone?: string | null;
    doctorName?: string | null;
    doctorLicense?: string | null;
    notes?: string | null;
    customerId?: string | null;
    createdBy: string;
    lines: Array<{
      productId: string;
      productUnitId: string;
      prescribedQuantity: number;
      dosage?: string | null;
      frequency?: string | null;
      duration?: string | null;
      notes?: string | null;
    }>;
    idempotencyKey?: string | undefined;
  }) {
    return this.database.db.transaction(async (transaction) => {
      if (input.idempotencyKey) {
        const existing = (
          await transaction
            .select()
            .from(idempotencyRecords)
            .where(
              and(
                eq(idempotencyRecords.key, input.idempotencyKey),
                eq(idempotencyRecords.scope, "sales.prescriptions.create"),
                eq(idempotencyRecords.actorId, input.createdBy),
              ),
            )
            .limit(1)
        )[0];
        if (existing) return { ...(JSON.parse(existing.response) as Record<string, unknown>), idempotentReplay: true };
      }
      const [prescription] = await transaction
        .insert(prescriptions)
        .values({
          prescriptionNumber: `RX-${new Date()
            .toISOString()
            .replace(/[-:.TZ]/g, "")
            .slice(0, 14)}-${Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0")}`,
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          patientName: input.patientName,
          patientPhone: input.patientPhone ?? null,
          doctorName: input.doctorName ?? null,
          doctorLicense: input.doctorLicense ?? null,
          notes: input.notes ?? null,
          customerId: input.customerId ?? null,
          status: "Pending",
          createdBy: input.createdBy,
        })
        .returning();
      if (!prescription) throw new Error("Prescription insert did not return a row");
      const lines = await transaction
        .insert(prescriptionLines)
        .values(
          input.lines.map((line) => ({
            ...line,
            prescriptionId: prescription.id,
            prescribedQuantity: String(line.prescribedQuantity),
            dispensedQuantity: "0",
          })),
        )
        .returning();
      await transaction.insert(outboxMessages).values({
        eventType: "sales.prescription.created.v1",
        aggregateId: prescription.id,
        payload: JSON.stringify({
          prescriptionId: prescription.id,
          siteId: prescription.siteId,
          actorId: input.createdBy,
        }),
      });
      const result = { ...prescription, lines };
      if (input.idempotencyKey)
        await transaction.insert(idempotencyRecords).values({
          key: input.idempotencyKey,
          scope: "sales.prescriptions.create",
          actorId: input.createdBy,
          response: JSON.stringify(result),
        });
      return result;
    });
  }

  public async getPrescription(id: string) {
    const prescription = (
      await this.database.db.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1)
    )[0];
    if (!prescription) return undefined;
    return {
      ...prescription,
      lines: await this.database.db.select().from(prescriptionLines).where(eq(prescriptionLines.prescriptionId, id)),
    };
  }

  public async listPrescriptions(input: {
    siteIds?: string[] | undefined;
    status?: string | undefined;
    customerId?: string | undefined;
    limit: number;
    q?: string | undefined;
    after?: PageCursor | undefined;
  }): Promise<Page<PrescriptionWithLines>> {
    const limit = clampLimit(input.limit);
    const fetched = await this.database.db
      .select({ ...getTableColumns(prescriptions), sortKey: createdAtSortKey(prescriptions.createdAt) })
      .from(prescriptions)
      .where(this.prescriptionFilter(input))
      .orderBy(desc(prescriptions.createdAt), desc(prescriptions.id))
      .limit(limit + 1);
    const page = toPage(fetched, limit);
    // One query for the lines of the whole page, grouped in memory, instead of one query per prescription.
    const lines =
      page.rows.length === 0
        ? []
        : await this.database.db
            .select()
            .from(prescriptionLines)
            .where(
              inArray(
                prescriptionLines.prescriptionId,
                page.rows.map((prescription) => prescription.id),
              ),
            );
    const linesByPrescription = new Map<string, Array<typeof prescriptionLines.$inferSelect>>();
    for (const line of lines) {
      const group = linesByPrescription.get(line.prescriptionId);
      if (group) group.push(line);
      else linesByPrescription.set(line.prescriptionId, [line]);
    }
    return {
      rows: page.rows.map((prescription) => ({
        ...prescription,
        lines: linesByPrescription.get(prescription.id) ?? [],
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** How many prescriptions the same filters select, for a count that must not depend on one page. */
  public async countPrescriptions(input: {
    siteIds?: string[] | undefined;
    status?: string | undefined;
    excludeStatuses?: string[] | undefined;
  }): Promise<number> {
    const [row] = await this.database.db
      .select({ total: count() })
      .from(prescriptions)
      .where(
        and(
          this.prescriptionFilter(input),
          input.excludeStatuses?.length ? notInArray(prescriptions.status, input.excludeStatuses) : undefined,
        ),
      );
    return row?.total ?? 0;
  }

  /** The filters a prescription list and its count share, so the two always describe the same rows. */
  private prescriptionFilter(input: {
    siteIds?: string[] | undefined;
    status?: string | undefined;
    customerId?: string | undefined;
    q?: string | undefined;
    after?: PageCursor | undefined;
  }) {
    return and(
      input.siteIds ? inArray(prescriptions.siteId, input.siteIds) : undefined,
      input.status ? eq(prescriptions.status, input.status) : undefined,
      input.customerId ? eq(prescriptions.customerId, input.customerId) : undefined,
      input.q
        ? or(
            ilike(prescriptions.prescriptionNumber, containsPattern(input.q)),
            ilike(prescriptions.patientName, containsPattern(input.q)),
            ilike(prescriptions.patientPhone, containsPattern(input.q)),
          )
        : undefined,
      afterCursor(prescriptions.createdAt, prescriptions.id, input.after),
    );
  }

  public async cancelPrescription(id: string, cancelledBy: string) {
    const current = (await this.database.db.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1))[0];
    if (!current) return undefined;
    transitionPrescription(current.status as PrescriptionStatus, "Cancelled");
    const [prescription] = await this.database.db
      .update(prescriptions)
      .set({ status: "Cancelled", cancelledBy, updatedAt: new Date() })
      .where(eq(prescriptions.id, id))
      .returning();
    if (prescription)
      await this.appendEvent("sales.prescription.cancelled.v1", prescription.id, {
        prescriptionId: prescription.id,
        cancelledBy,
        actorId: cancelledBy,
      });
    return prescription;
  }

  public async setPrescriptionReservation(id: string, reservationId: string) {
    const [prescription] = await this.database.db
      .update(prescriptions)
      .set({ reservationId, updatedAt: new Date() })
      .where(eq(prescriptions.id, id))
      .returning();
    return prescription;
  }

  /**
   * Records a dispense and takes the goods off the shelf in one step. The prescription row is locked first, so two
   * submissions of the same dispense are judged one after the other and the second is refused before any stock
   * moves. `dispenseStock` runs inside the transaction: when inventory refuses, nothing is recorded here either.
   */
  public async dispensePrescription(
    id: string,
    input: Array<{ prescriptionLineId: string; productBatchId: string; dispensedQuantity: number }>,
    dispensedBy: string,
    dispenseStock: (dispense: PrescriptionStockDispense) => Promise<void>,
    idempotencyKey?: string,
  ) {
    return this.database.db.transaction(async (transaction) => {
      const prescription = (
        await transaction.select().from(prescriptions).where(eq(prescriptions.id, id)).limit(1).for("update")
      )[0];
      if (!prescription) return undefined;
      if (idempotencyKey) {
        const existing = (
          await transaction
            .select()
            .from(idempotencyRecords)
            .where(
              and(
                eq(idempotencyRecords.key, idempotencyKey),
                eq(idempotencyRecords.scope, "sales.prescriptions.dispense"),
                eq(idempotencyRecords.actorId, dispensedBy),
              ),
            )
            .limit(1)
        )[0];
        if (existing) return { ...(JSON.parse(existing.response) as Record<string, unknown>), idempotentReplay: true };
      }
      if (!["Pending", "PartiallyDispensed"].includes(prescription.status))
        throw new PrescriptionDispenseError("Prescription is not available for dispensing");
      const lines = await transaction.select().from(prescriptionLines).where(eq(prescriptionLines.prescriptionId, id));
      const requestedIds = new Set(input.map((line) => line.prescriptionLineId));
      if (input.some((line) => !lines.some((existing) => existing.id === line.prescriptionLineId)))
        throw new PrescriptionDispenseError("Prescription line was not found");
      // Two entries for one line add up, so the prescribed ceiling is checked against their sum.
      const dispensedSoFar = new Map(lines.map((line) => [line.id, Number(line.dispensedQuantity)]));
      const stockLines: PrescriptionStockDispense["lines"] = [];
      for (const line of input) {
        const existing = lines.find((candidate) => candidate.id === line.prescriptionLineId);
        const total = (dispensedSoFar.get(line.prescriptionLineId) ?? 0) + line.dispensedQuantity;
        if (!existing || total > Number(existing.prescribedQuantity))
          throw new PrescriptionDispenseError("Dispensed quantity exceeds prescribed quantity");
        dispensedSoFar.set(line.prescriptionLineId, total);
        stockLines.push({
          productId: existing.productId,
          productBatchId: line.productBatchId,
          quantity: line.dispensedQuantity,
        });
        await transaction
          .update(prescriptionLines)
          .set({ dispensedQuantity: String(total), productBatchId: line.productBatchId })
          .where(eq(prescriptionLines.id, line.prescriptionLineId));
      }
      await dispenseStock({
        prescriptionId: id,
        reservationId: prescription.reservationId,
        siteId: prescription.siteId,
        storageLocationId: prescription.storageLocationId,
        lines: stockLines,
      });
      const refreshed = await transaction
        .select()
        .from(prescriptionLines)
        .where(eq(prescriptionLines.prescriptionId, id));
      const complete = refreshed.every((line) => Number(line.dispensedQuantity) >= Number(line.prescribedQuantity));
      const anyDispensed = refreshed.some((line) => Number(line.dispensedQuantity) > 0);
      const status = complete ? "Dispensed" : anyDispensed ? "PartiallyDispensed" : prescription.status;
      const [updated] = await transaction
        .update(prescriptions)
        .set({
          status,
          ...(status === "Dispensed" ? { dispensedBy: dispensedBy, dispensedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(prescriptions.id, id))
        .returning();
      await transaction.insert(outboxMessages).values({
        eventType: "sales.prescription.dispensed.v1",
        aggregateId: id,
        payload: JSON.stringify({ prescriptionId: id, dispensedBy, actorId: dispensedBy, lineIds: [...requestedIds] }),
      });
      const result = updated ? { ...updated, lines: refreshed } : undefined;
      if (result && idempotencyKey)
        await transaction.insert(idempotencyRecords).values({
          key: idempotencyKey,
          scope: "sales.prescriptions.dispense",
          actorId: dispensedBy,
          response: JSON.stringify(result),
        });
      return result;
    });
  }

  /** Still the prescription list, under the counter's name; see the route for why the two share one query. */
  public async listCounterTransactions(input: {
    siteIds?: string[] | undefined;
    status?: string | undefined;
    q?: string | undefined;
    after?: PageCursor | undefined;
    limit: number;
  }) {
    return this.listPrescriptions(input);
  }

  /**
   * The online orders and counter prescriptions created in `[from, to)`, for the period analytics. Each side is narrowed
   * to its own site column: `siteIds` omitted means every site, and an empty list matches nothing.
   */
  public async listSalesDocuments(input: {
    from: Date;
    to: Date;
    siteIds?: string[] | undefined;
  }): Promise<SalesDocument[]> {
    const [orderRows, prescriptionRows] = await Promise.all([
      this.database.db
        .select({
          id: orders.id,
          siteId: orders.selectedStoreId,
          customerId: orders.customerId,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(
          and(
            gte(orders.createdAt, input.from),
            lt(orders.createdAt, input.to),
            input.siteIds ? inArray(orders.selectedStoreId, input.siteIds) : undefined,
          ),
        )
        .orderBy(asc(orders.createdAt), asc(orders.id)),
      this.database.db
        .select({
          id: prescriptions.id,
          siteId: prescriptions.siteId,
          customerId: prescriptions.customerId,
          createdAt: prescriptions.createdAt,
        })
        .from(prescriptions)
        .where(
          and(
            gte(prescriptions.createdAt, input.from),
            lt(prescriptions.createdAt, input.to),
            input.siteIds ? inArray(prescriptions.siteId, input.siteIds) : undefined,
          ),
        )
        .orderBy(asc(prescriptions.createdAt), asc(prescriptions.id)),
    ]);
    return [
      ...orderRows.map((row) => ({
        id: row.id,
        kind: "order" as const,
        siteId: row.siteId,
        customerId: row.customerId,
        createdAt: row.createdAt.toISOString(),
      })),
      ...prescriptionRows.map((row) => ({
        id: row.id,
        kind: "prescription" as const,
        siteId: row.siteId,
        customerId: row.customerId,
        createdAt: row.createdAt.toISOString(),
      })),
    ];
  }

  /**
   * The first payment ever seen for every customer who bought in the period, across orders and prescriptions. The
   * period names the customer set; the payment date is the customer's whole history. A customer whose first payment
   * is inside the period is new, an earlier one returning. The site filter narrows the customers to the period sales
   * of those sites, never the history that decides the date.
   */
  public async listCustomerFirstPaid(input: {
    from: Date;
    to: Date;
    siteIds?: string[] | undefined;
  }): Promise<CustomerFirstPaid[]> {
    const siteFilter = (column: SQL): SQL => {
      if (!input.siteIds) return sql``;
      if (input.siteIds.length === 0) return sql`and false`;
      return sql`and ${column} in (${sql.join(
        input.siteIds.map((siteId) => sql`${siteId}`),
        sql`, `,
      )})`;
    };
    const result = await this.database.db.execute<{ customerId: string; firstPaidAt: Date | string }>(sql`
      select paid.customer_id as "customerId", min(paid.paid_at) as "firstPaidAt"
      from (
        select customer_id, paid_at from orders where paid_at is not null
        union all
        select customer_id, paid_at from prescriptions where paid_at is not null
      ) paid
      where exists (
        select 1 from orders o
        where o.customer_id = paid.customer_id
          and o.created_at >= ${input.from} and o.created_at < ${input.to} ${siteFilter(sql`o.selected_store_id`)}
      ) or exists (
        select 1 from prescriptions p
        where p.customer_id = paid.customer_id
          and p.created_at >= ${input.from} and p.created_at < ${input.to} ${siteFilter(sql`p.site_id`)}
      )
      group by paid.customer_id
      order by paid.customer_id
    `);
    return result.rows.map((row) => ({
      customerId: row.customerId,
      firstPaidAt: (row.firstPaidAt instanceof Date ? row.firstPaidAt : new Date(row.firstPaidAt)).toISOString(),
    }));
  }

  /** The targets a caller may see for one `YYYY-MM` month, narrowed to the sites it names. */
  public async listSalesTargets(input: { month: string; siteIds?: string[] | undefined }): Promise<SalesTarget[]> {
    if (input.siteIds?.length === 0) return [];
    const rows = await this.database.db
      .select({
        siteId: salesTargets.siteId,
        month: salesTargets.month,
        amount: salesTargets.amount,
        currency: salesTargets.currency,
      })
      .from(salesTargets)
      .where(
        and(
          eq(salesTargets.month, `${input.month}-01`),
          input.siteIds ? inArray(salesTargets.siteId, input.siteIds) : undefined,
        ),
      )
      .orderBy(asc(salesTargets.siteId));
    return rows.map((row) => ({
      siteId: row.siteId,
      month: row.month.slice(0, 7),
      amount: Number(row.amount),
      currency: row.currency,
    }));
  }

  /** Writes one site's target for a month, replacing the amount when the pair already has one. */
  public async setSalesTarget(input: {
    siteId: string;
    month: string;
    amount: number;
    actorId: string;
  }): Promise<SalesTarget> {
    const amount = input.amount.toFixed(2);
    const [row] = await this.database.db
      .insert(salesTargets)
      .values({
        siteId: input.siteId,
        month: `${input.month}-01`,
        amount,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      })
      .onConflictDoUpdate({
        target: [salesTargets.siteId, salesTargets.month],
        set: { amount, updatedBy: input.actorId, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error("The sales target was not written");
    await this.appendEvent("sales.target.set.v1", row.id, {
      targetId: row.id,
      siteId: row.siteId,
      month: input.month,
      amount: Number(row.amount),
      actorId: input.actorId,
    });
    return {
      siteId: row.siteId,
      month: input.month,
      amount: Number(row.amount),
      currency: row.currency,
    };
  }

  private async findCart(database: SalesDatabase["db"], customerId: string) {
    return (await database.select().from(carts).where(eq(carts.customerId, customerId)).limit(1))[0];
  }

  private async withCartLines(database: SalesDatabase["db"], cart: typeof carts.$inferSelect) {
    return {
      ...cart,
      lines: await database.select().from(cartLines).where(eq(cartLines.cartId, cart.id)).orderBy(asc(cartLines.id)),
    };
  }

  private async appendEvent(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await this.database.db.insert(outboxMessages).values({ eventType, aggregateId, payload: JSON.stringify(payload) });
  }
}
