import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
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
  idempotencyRecords,
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

  public async getCart(customerId: string | undefined, guestToken: string | undefined) {
    const cart = await this.findCart(this.database.db, customerId, guestToken);
    if (!cart) return undefined;
    return this.withCartLines(this.database.db, cart);
  }

  public async getOrCreateCart(customerId: string | undefined, guestToken: string | undefined) {
    this.assertCartIdentity(customerId, guestToken);
    const existing = await this.getCart(customerId, guestToken);
    if (existing) return existing;
    const [cart] = await this.database.db
      .insert(carts)
      .values({
        customerId: customerId ?? null,
        guestTokenDigest: customerId ? null : digestToken(guestToken as string),
      })
      .onConflictDoNothing({ target: customerId ? carts.customerId : carts.guestTokenDigest })
      .returning();
    if (cart) return { ...cart, lines: [] };

    const concurrentCart = await this.getCart(customerId, guestToken);
    if (!concurrentCart) throw new Error("Cart insert did not return a row");
    return concurrentCart;
  }

  public async addCartLine(
    customerId: string | undefined,
    guestToken: string | undefined,
    input: { productId: string; productUnitId: string; quantity: number },
  ) {
    this.assertCartIdentity(customerId, guestToken);
    const cart = await this.getOrCreateCart(customerId, guestToken);
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
    return this.getCart(customerId, guestToken);
  }

  public async clearCart(customerId: string | undefined, guestToken: string | undefined) {
    this.assertCartIdentity(customerId, guestToken);
    const cart = await this.getCart(customerId, guestToken);
    if (!cart) return undefined;
    await this.database.db.delete(cartLines).where(eq(cartLines.cartId, cart.id));
    await this.database.db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id));
    return this.getCart(customerId, guestToken);
  }

  public async updateCartLine(
    customerId: string | undefined,
    guestToken: string | undefined,
    lineId: string,
    quantity: number,
  ) {
    this.assertCartIdentity(customerId, guestToken);
    const cart = await this.getCart(customerId, guestToken);
    if (!cart) return undefined;
    if (quantity === 0)
      await this.database.db.delete(cartLines).where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
    else
      await this.database.db
        .update(cartLines)
        .set({ quantity: String(quantity) })
        .where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cart.id)));
    return this.getCart(customerId, guestToken);
  }

  public async mergeGuestCart(customerId: string, guestToken: string) {
    const guest = await this.getCart(undefined, guestToken);
    const customer = await this.getOrCreateCart(customerId, undefined);
    if (!guest || guest.id === customer.id) return customer;
    await this.database.db.transaction(async (transaction) => {
      for (const line of guest.lines) {
        const current = (
          await transaction
            .select()
            .from(cartLines)
            .where(
              and(
                eq(cartLines.cartId, customer.id),
                eq(cartLines.productId, line.productId),
                eq(cartLines.productUnitId, line.productUnitId),
              ),
            )
            .limit(1)
        )[0];
        if (current) {
          await transaction
            .update(cartLines)
            .set({ quantity: String(Number(current.quantity) + Number(line.quantity)) })
            .where(eq(cartLines.id, current.id));
          await transaction.delete(cartLines).where(eq(cartLines.id, line.id));
        } else {
          await transaction.update(cartLines).set({ cartId: customer.id }).where(eq(cartLines.id, line.id));
        }
      }
      await transaction.delete(carts).where(eq(carts.id, guest.id));
      await transaction.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, customer.id));
    });
    return this.getCart(customerId, undefined);
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
      await transaction.insert(outboxMessages).values({
        eventType: "sales.order.created.v1",
        aggregateId: order.id,
        payload: JSON.stringify({
          orderId: order.id,
          customerId: order.customerId,
          selectedStoreId: order.selectedStoreId,
          fulfillmentType: order.fulfillmentType,
        }),
      });
      return order;
    });
  }

  public async listOrders(input: {
    customerId?: string | undefined;
    status?: string | undefined;
    paymentStatus?: string | undefined;
    selectedStoreId?: string | undefined;
    limit?: number | undefined;
  }) {
    const filters = [
      input.customerId ? eq(orders.customerId, input.customerId) : undefined,
      input.status ? eq(orders.status, input.status) : undefined,
      input.paymentStatus ? eq(orders.paymentStatus, input.paymentStatus) : undefined,
      input.selectedStoreId ? eq(orders.selectedStoreId, input.selectedStoreId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    return this.database.db
      .select()
      .from(orders)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(orders.createdAt))
      .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
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

  public async transitionOrder(id: string, next: OrderStatus) {
    const current = (await this.database.db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
    if (!current) return undefined;
    transitionOrder(current.status as OrderStatus, next);
    const [order] = await this.database.db
      .update(orders)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    if (order)
      await this.appendEvent("sales.order.status-changed.v1", order.id, { orderId: order.id, status: order.status });
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
        ...(confirming ? { status: transitionOrder("Pending", "Confirmed") } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, id))
      .returning();
    if (order && confirming)
      await this.appendEvent("sales.order.status-changed.v1", order.id, { orderId: order.id, status: order.status });
    return order;
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
        payload: JSON.stringify({ prescriptionId: prescription.id, siteId: prescription.siteId }),
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
  }) {
    const filters = [
      input.siteIds ? inArray(prescriptions.siteId, input.siteIds) : undefined,
      input.status ? eq(prescriptions.status, input.status) : undefined,
      input.customerId ? eq(prescriptions.customerId, input.customerId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const rows = await this.database.db
      .select()
      .from(prescriptions)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(prescriptions.createdAt))
      .limit(Math.min(Math.max(input.limit, 1), 500));
    return Promise.all(
      rows.map(async (prescription) => ({
        ...prescription,
        lines: await this.database.db
          .select()
          .from(prescriptionLines)
          .where(eq(prescriptionLines.prescriptionId, prescription.id)),
      })),
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
        payload: JSON.stringify({ prescriptionId: id, dispensedBy, lineIds: [...requestedIds] }),
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

  public async listCounterTransactions(input: { siteIds?: string[]; status?: string; limit: number }) {
    return this.listPrescriptions(input);
  }

  private async findCart(
    database: SalesDatabase["db"],
    customerId: string | undefined,
    guestToken: string | undefined,
  ) {
    const digest = guestToken ? digestToken(guestToken) : undefined;
    const condition = customerId
      ? eq(carts.customerId, customerId)
      : digest
        ? eq(carts.guestTokenDigest, digest)
        : undefined;
    return (await database.select().from(carts).where(condition).limit(1))[0];
  }

  private async withCartLines(database: SalesDatabase["db"], cart: typeof carts.$inferSelect) {
    return {
      ...cart,
      lines: await database.select().from(cartLines).where(eq(cartLines.cartId, cart.id)).orderBy(asc(cartLines.id)),
    };
  }

  private assertCartIdentity(customerId: string | undefined, guestToken: string | undefined): void {
    if (!customerId && !guestToken) throw new Error("A customer session or guest cart token is required");
  }

  private async appendEvent(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<void> {
    await this.database.db.insert(outboxMessages).values({ eventType, aggregateId, payload: JSON.stringify(payload) });
  }
}

const digestToken = (token: string): string => createHash("sha256").update(token).digest("hex");
