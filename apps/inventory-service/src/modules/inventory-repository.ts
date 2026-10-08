import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import {
  idempotencyRecords,
  inventoryBalances,
  outboxMessages,
  productBatches,
  replenishmentRequestLines,
  replenishmentRequests,
  stockLedgerEntries,
  returnLines,
  returnRequests,
  stockReservationLines,
  stockReservations,
  stockAdjustments,
  stocktakeLines,
  stocktakes,
  transferOrderLines,
  transferOrders,
} from "../shared/infrastructure/schema.ts";
import { allocateFefo } from "./stock/application/fefo-allocate.ts";
import { transitionReplenishment, type ReplenishmentStatus } from "./replenishment/domain/replenishment-request.ts";
import { transitionTransfer, type TransferStatus } from "./transfers/domain/transfer-order.ts";
import { recordSiteAvailability, sellableBatch, today, type Availability } from "./site-availability.ts";

/** A dispense the stock cannot honour: the batch is wrong for the product, not releasable, or not on the shelf. */
export class StockDispenseError extends Error {}

export type StockDispenseLine = { productId: string; productBatchId: string; quantity: number };

export type StockDispense = {
  /** Idempotency key: the same dispense sent twice moves stock once and answers the first result again. */
  dispenseId: string;
  /** The reservation held for this sale; its held quantity is released as the goods leave. */
  reservationId?: string | undefined;
  /** The prescription the goods left for, recorded on every ledger entry. */
  referenceId: string;
  siteId: string;
  storageLocationId: string;
  /** The pharmacist who handed the goods over; the idempotency key is scoped to them. */
  actorId: string;
  lines: StockDispenseLine[];
};

export type StockDispenseResult = {
  dispenseId: string;
  reservationStatus: string | null;
  entries: Array<typeof stockLedgerEntries.$inferSelect>;
};

const DISPENSE_SCOPE = "inventory.dispense";

export class InventoryRepository {
  public constructor(
    private readonly database: InventoryDatabase,
    private readonly publishAvailability?: (input: Availability) => Promise<void>,
  ) {}

  private async publishAvailabilitySafely({ productId, siteId, inStock }: Availability): Promise<void> {
    if (!this.publishAvailability) return;
    try {
      await this.publishAvailability({ productId, siteId, inStock });
    } catch {
      // The local stock transaction remains authoritative. The outbox retry handles broker recovery.
    }
  }

  public async listBalances(
    productId?: string,
    siteIds?: string[],
    storageLocationId?: string,
    includeZeroBalances = true,
  ) {
    const filters = [
      productId ? eq(productBatches.productId, productId) : undefined,
      siteIds ? inArray(inventoryBalances.siteId, siteIds) : undefined,
      storageLocationId ? eq(inventoryBalances.storageLocationId, storageLocationId) : undefined,
      includeZeroBalances ? undefined : gt(inventoryBalances.quantityOnHand, "0"),
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    return this.database.db
      .select({ balance: inventoryBalances, batch: productBatches })
      .from(inventoryBalances)
      .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(productBatches.expiryDate));
  }

  public async listBatches(productId?: string) {
    return this.database.db
      .select()
      .from(productBatches)
      .where(productId ? eq(productBatches.productId, productId) : undefined)
      .orderBy(asc(productBatches.expiryDate));
  }

  public async listMovements(
    input: {
      productId?: string | undefined;
      productBatchId?: string | undefined;
      siteIds?: string[] | undefined;
      storageLocationId?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const conditions = [
      input.productId ? eq(stockLedgerEntries.productId, input.productId) : undefined,
      input.productBatchId ? eq(stockLedgerEntries.productBatchId, input.productBatchId) : undefined,
      input.siteIds ? inArray(stockLedgerEntries.siteId, input.siteIds) : undefined,
      input.storageLocationId ? eq(stockLedgerEntries.storageLocationId, input.storageLocationId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    return this.database.db
      .select()
      .from(stockLedgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stockLedgerEntries.occurredAt))
      .limit(Math.min(Math.max(input.limit ?? 500, 1), 500));
  }

  /**
   * Ledger movements of a period grouped by movement type: how often each happened, what it brought in, what it took
   * out, and when it last happened. Summed in the database, so a busy period is never cut to one page of movements.
   */
  public async summarizeMovements(input: { siteIds?: string[] | undefined; from?: Date; to?: Date }) {
    const conditions = [
      input.siteIds ? inArray(stockLedgerEntries.siteId, input.siteIds) : undefined,
      input.from ? gte(stockLedgerEntries.occurredAt, input.from) : undefined,
      input.to ? lte(stockLedgerEntries.occurredAt, input.to) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const latest = sql<Date>`max(${stockLedgerEntries.occurredAt})`;
    const rows = await this.database.db
      .select({
        movementType: stockLedgerEntries.movementType,
        count: sql<number>`count(*)::int`,
        quantityIn: sql<string>`coalesce(sum(${stockLedgerEntries.quantityDelta}) filter (where ${stockLedgerEntries.quantityDelta} > 0), 0)`,
        quantityOut: sql<string>`coalesce(-sum(${stockLedgerEntries.quantityDelta}) filter (where ${stockLedgerEntries.quantityDelta} < 0), 0)`,
        latestOccurredAt: latest,
      })
      .from(stockLedgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(stockLedgerEntries.movementType)
      .orderBy(desc(latest));
    return rows.map((row) => ({
      movementType: row.movementType,
      count: Number(row.count),
      quantityIn: Number(row.quantityIn),
      quantityOut: Number(row.quantityOut),
      latestOccurredAt: new Date(row.latestOccurredAt).toISOString(),
    }));
  }

  public async listAdjustments(
    input: {
      siteIds?: string[] | undefined;
      status?: string | undefined;
      stocktakeSessionId?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const conditions = [
      input.siteIds ? inArray(stockAdjustments.siteId, input.siteIds) : undefined,
      input.status ? eq(stockAdjustments.status, input.status) : undefined,
      input.stocktakeSessionId ? eq(stockAdjustments.stocktakeSessionId, input.stocktakeSessionId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    return this.database.db
      .select()
      .from(stockAdjustments)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stockAdjustments.createdAt))
      .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
  }

  public async createAdjustment(input: {
    productId: string;
    productBatchId: string;
    siteId: string;
    storageLocationId: string;
    adjustmentType: "Positive" | "Negative";
    quantity: number;
    reason: string;
    notes?: string | null | undefined;
    createdBy: string;
  }) {
    const [adjustment] = await this.database.db
      .insert(stockAdjustments)
      .values({ ...input, quantity: String(input.quantity), notes: input.notes ?? null })
      .returning();
    return adjustment;
  }

  public async transitionAdjustment(id: string, action: "approve" | "reject", actorId: string, approvalNotes?: string) {
    const result = await this.database.db.transaction(async (transaction) => {
      const adjustment = (
        await transaction.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).limit(1).for("update")
      )[0];
      if (!adjustment) return undefined;
      if (adjustment.status !== "Pending") throw new Error(`Adjustment is already ${adjustment.status}`);
      if (action === "reject") {
        const [rejected] = await transaction
          .update(stockAdjustments)
          .set({ status: "Rejected", approvedBy: actorId, approvalNotes: approvalNotes ?? null, updatedAt: new Date() })
          .where(eq(stockAdjustments.id, id))
          .returning();
        return { adjustment: rejected, availability: undefined };
      }
      const batch = (
        await transaction.select().from(productBatches).where(eq(productBatches.id, adjustment.productBatchId)).limit(1)
      )[0];
      if (!batch || batch.productId !== adjustment.productId)
        throw new Error("Adjustment batch does not match the product");
      const balance = (
        await transaction
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.productBatchId, adjustment.productBatchId),
              eq(inventoryBalances.siteId, adjustment.siteId),
              eq(inventoryBalances.storageLocationId, adjustment.storageLocationId),
            ),
          )
          .limit(1)
          .for("update")
      )[0];
      const previousOnHand = Number(balance?.quantityOnHand ?? 0);
      const quantityReserved = Number(balance?.quantityReserved ?? 0);
      const delta =
        adjustment.adjustmentType === "Positive" ? Number(adjustment.quantity) : -Number(adjustment.quantity);
      const nextOnHand = previousOnHand + delta;
      if (nextOnHand < quantityReserved || nextOnHand < 0)
        throw new Error("Adjustment would make available stock negative");
      const updatedBalance = balance
        ? (
            await transaction
              .update(inventoryBalances)
              .set({
                quantityOnHand: String(nextOnHand),
                version: sql`${inventoryBalances.version} + 1`,
                updatedAt: new Date(),
              })
              .where(and(eq(inventoryBalances.id, balance.id), eq(inventoryBalances.version, balance.version)))
              .returning()
          )[0]
        : (
            await transaction
              .insert(inventoryBalances)
              .values({
                productBatchId: adjustment.productBatchId,
                siteId: adjustment.siteId,
                storageLocationId: adjustment.storageLocationId,
                quantityOnHand: String(nextOnHand),
                quantityReserved: "0",
              })
              .returning()
          )[0];
      if (!updatedBalance) throw new Error("Adjustment balance was not saved");
      await transaction.insert(stockLedgerEntries).values({
        productId: adjustment.productId,
        productBatchId: adjustment.productBatchId,
        siteId: adjustment.siteId,
        storageLocationId: adjustment.storageLocationId,
        quantityDelta: String(delta),
        quantityAfter: String(nextOnHand),
        movementType: "StockAdjustment",
        reason: adjustment.reason,
      });
      const availability = await recordSiteAvailability(transaction, adjustment.productId, adjustment.siteId);
      const [approved] = await transaction
        .update(stockAdjustments)
        .set({ status: "Approved", approvedBy: actorId, approvalNotes: approvalNotes ?? null, updatedAt: new Date() })
        .where(eq(stockAdjustments.id, id))
        .returning();
      return { adjustment: approved, availability };
    });
    if (!result) return undefined;
    if (result.availability) await this.publishAvailabilitySafely(result.availability);
    return result.adjustment;
  }

  public async createBatch(input: typeof productBatches.$inferInsert) {
    const [batch] = await this.database.db.insert(productBatches).values(input).returning();
    if (!batch) throw new Error("Batch insert did not return a row");
    return batch;
  }

  /**
   * Quality control's verdict decides whether a batch may be sold, so every site holding it gets its availability
   * recorded again: a release can put a product back in stock, a rejection can take it out.
   */
  public async reviewBatch(
    id: string,
    qualityStatus: "Released" | "Rejected",
    qualityNotes?: string | null,
    reviewedBy?: string,
  ) {
    const result = await this.database.db.transaction(async (transaction) => {
      const [batch] = await transaction
        .update(productBatches)
        .set({
          qualityStatus,
          qualityNotes: qualityNotes ?? null,
          qualityReviewedBy: reviewedBy ?? null,
          qualityReviewedAt: new Date(),
        })
        .where(eq(productBatches.id, id))
        .returning();
      if (!batch) return undefined;
      const sites = await transaction
        .selectDistinct({ siteId: inventoryBalances.siteId })
        .from(inventoryBalances)
        .where(eq(inventoryBalances.productBatchId, id));
      const availability: Availability[] = [];
      for (const { siteId } of sites)
        availability.push(await recordSiteAvailability(transaction, batch.productId, siteId));
      return { batch, availability };
    });
    if (!result) return undefined;
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.batch;
  }

  public async fefoAllocate(input: { productId: string; siteId: string; quantityNeeded: number }) {
    const rows = await this.database.db
      .select({ balance: inventoryBalances, batch: productBatches })
      .from(inventoryBalances)
      .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
      .where(
        and(eq(productBatches.productId, input.productId), eq(inventoryBalances.siteId, input.siteId), sellableBatch()),
      );
    const allocations = allocateFefo(
      rows.map(({ balance, batch }) => ({
        productBatchId: batch.id,
        storageLocationId: balance.storageLocationId,
        expiryDate: batch.expiryDate,
        batchNumber: batch.batchNumber,
        quantityOnHand: Number(balance.quantityOnHand),
        quantityReserved: Number(balance.quantityReserved),
      })),
      input.quantityNeeded,
    );
    return {
      productId: input.productId,
      siteId: input.siteId,
      quantityRequested: input.quantityNeeded,
      quantityAllocated: input.quantityNeeded,
      lines: allocations.map((allocation) => {
        const row = rows.find(
          ({ batch, balance }) =>
            batch.id === allocation.productBatchId && balance.storageLocationId === allocation.storageLocationId,
        );
        return {
          productBatchId: allocation.productBatchId,
          batchNumber: row?.batch.batchNumber ?? "",
          expiryDate: row?.batch.expiryDate ?? "",
          storageLocationId: allocation.storageLocationId,
          quantityToConsume: allocation.quantity,
          quantityAvailable: Number(row?.balance.quantityOnHand ?? 0),
        };
      }),
    };
  }

  public async recordMovement(input: {
    productId: string;
    productBatchId: string;
    siteId: string;
    storageLocationId: string;
    quantityDelta: number;
    movementType: string;
    reason?: string | undefined;
    occurredAtUtc?: string | null | undefined;
    referenceType?: string | null | undefined;
    referenceId?: string | null | undefined;
    notes?: string | null | undefined;
    createdBy?: string | undefined;
  }) {
    const result = await this.database.db.transaction(async (transaction) => {
      const current = await transaction
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productBatchId, input.productBatchId),
            eq(inventoryBalances.storageLocationId, input.storageLocationId),
          ),
        )
        .for("update");
      const row = current[0];
      const previousOnHand = Number(row?.quantityOnHand ?? 0);
      const reserved = Number(row?.quantityReserved ?? 0);
      const nextOnHand = previousOnHand + input.quantityDelta;
      if (nextOnHand < reserved || nextOnHand < 0) throw new Error("Movement would make available stock negative");
      let balance;
      if (row) {
        const updated = await transaction
          .update(inventoryBalances)
          .set({
            quantityOnHand: String(nextOnHand),
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(inventoryBalances.id, row.id), eq(inventoryBalances.version, row.version)))
          .returning();
        balance = updated[0];
        if (!balance) throw new Error("Concurrent inventory update detected");
      } else {
        const inserted = await transaction
          .insert(inventoryBalances)
          .values({
            productBatchId: input.productBatchId,
            siteId: input.siteId,
            storageLocationId: input.storageLocationId,
            quantityOnHand: String(nextOnHand),
            quantityReserved: "0",
          })
          .returning();
        balance = inserted[0];
      }
      if (!balance) throw new Error("Inventory balance was not saved");
      const [ledger] = await transaction
        .insert(stockLedgerEntries)
        .values({
          productId: input.productId,
          productBatchId: input.productBatchId,
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          quantityDelta: String(input.quantityDelta),
          quantityAfter: String(nextOnHand),
          movementType: input.movementType,
          occurredAt: input.occurredAtUtc ? new Date(input.occurredAtUtc) : new Date(),
          referenceType: input.referenceType ?? null,
          referenceId: input.referenceId ?? null,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      const availability = await recordSiteAvailability(transaction, input.productId, input.siteId);
      return { balance, ledger, availability };
    });
    await this.publishAvailabilitySafely(result.availability);
    return { balance: result.balance, ledger: result.ledger };
  }

  public async reserve(input: {
    reservationId: string;
    ownerId: string;
    siteId: string;
    storageLocationId: string;
    lines: Array<{ productId: string; quantity: number }>;
  }) {
    const result = await this.database.db.transaction(async (transaction) => {
      await transaction
        .insert(stockReservations)
        .values({ id: input.reservationId, ownerId: input.ownerId, status: "active" })
        .onConflictDoUpdate({
          target: stockReservations.id,
          set: { ownerId: input.ownerId, status: "active", updatedAt: new Date() },
        });
      const allocations: Array<{
        productId: string;
        productBatchId: string;
        storageLocationId: string;
        quantity: number;
      }> = [];
      for (const line of input.lines) {
        const rows = await transaction
          .select({ balance: inventoryBalances, batch: productBatches })
          .from(inventoryBalances)
          .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
          .where(
            and(
              eq(productBatches.productId, line.productId),
              sellableBatch(),
              eq(inventoryBalances.siteId, input.siteId),
              eq(inventoryBalances.storageLocationId, input.storageLocationId),
              gt(inventoryBalances.quantityOnHand, inventoryBalances.quantityReserved),
            ),
          )
          .for("update");
        const fefo = allocateFefo(
          rows.map(({ balance, batch }) => ({
            productBatchId: batch.id,
            storageLocationId: balance.storageLocationId,
            expiryDate: batch.expiryDate,
            batchNumber: batch.batchNumber,
            quantityOnHand: Number(balance.quantityOnHand),
            quantityReserved: Number(balance.quantityReserved),
          })),
          line.quantity,
        );
        for (const allocation of fefo) {
          await transaction
            .update(inventoryBalances)
            .set({
              quantityReserved: sql`${inventoryBalances.quantityReserved} + ${String(allocation.quantity)}`,
              version: sql`${inventoryBalances.version} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(inventoryBalances.productBatchId, allocation.productBatchId),
                eq(inventoryBalances.storageLocationId, allocation.storageLocationId),
              ),
            );
          await transaction.insert(stockReservationLines).values({
            reservationId: input.reservationId,
            productId: line.productId,
            productBatchId: allocation.productBatchId,
            storageLocationId: allocation.storageLocationId,
            quantity: String(allocation.quantity),
          });
          allocations.push({ productId: line.productId, ...allocation });
        }
      }
      // A hold is a change in what a shopper may buy, so every product it touched is answered again once committed.
      const availability: Availability[] = [];
      for (const productId of new Set(input.lines.map((line) => line.productId)))
        availability.push(await recordSiteAvailability(transaction, productId, input.siteId));
      return { allocations, availability };
    });
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.allocations;
  }

  /**
   * Gives back whatever a reservation still holds. A reservation line's quantity is what it still holds, so a
   * partly dispensed prescription releases only the rest, and a reservation that is no longer active is answered
   * as it is, which keeps a repeated cancel from releasing another sale's hold.
   */
  public async releaseReservation(id: string) {
    const { reservation, availability } = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.id, id))
        .for("update");
      if (!current || current.status !== "active") return { reservation: current, availability: [] as Availability[] };
      const lines = await transaction
        .select()
        .from(stockReservationLines)
        .where(eq(stockReservationLines.reservationId, id));
      // A line carries no site, so the balance row that gave the hold back is what names the site to answer for.
      const answered = new Set<string>();
      const availability: Availability[] = [];
      for (const line of lines) {
        const released = await transaction
          .update(inventoryBalances)
          .set({
            quantityReserved: sql`GREATEST(${inventoryBalances.quantityReserved} - ${line.quantity}, 0)`,
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryBalances.productBatchId, line.productBatchId),
              eq(inventoryBalances.storageLocationId, line.storageLocationId),
            ),
          )
          .returning({ siteId: inventoryBalances.siteId });
        for (const { siteId } of released) {
          const pair = `${line.productId}:${siteId}`;
          if (answered.has(pair)) continue;
          answered.add(pair);
          availability.push(await recordSiteAvailability(transaction, line.productId, siteId));
        }
      }
      await transaction
        .update(stockReservationLines)
        .set({ quantity: "0" })
        .where(eq(stockReservationLines.reservationId, id));
      const [released] = await transaction
        .update(stockReservations)
        .set({ status: "released", updatedAt: new Date() })
        .where(eq(stockReservations.id, id))
        .returning();
      return { reservation: released, availability };
    });
    for (const item of availability) await this.publishAvailabilitySafely(item);
    return reservation;
  }

  /**
   * Re-answers availability for stock that expired with nothing moving on the shelf. A balance on a released batch
   * that has crossed its expiry date drops out of what a site can sell, and only a sweep notices. The pairs are the
   * ones that had free stock on such a batch, because a batch nobody could buy never showed up as available;
   * `expiredOnOrAfter` gives the sweeper a lower bound so an expiry is not answered again on every run.
   */
  public async refreshAvailabilityForExpiredStock(expiredOnOrAfter?: string): Promise<number> {
    const { availability } = await this.database.db.transaction(async (transaction) => {
      const pairs = await transaction
        .selectDistinct({ productId: productBatches.productId, siteId: inventoryBalances.siteId })
        .from(inventoryBalances)
        .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
        .where(
          and(
            gt(inventoryBalances.quantityOnHand, inventoryBalances.quantityReserved),
            eq(productBatches.qualityStatus, "Released"),
            lt(productBatches.expiryDate, today()),
            expiredOnOrAfter ? gte(productBatches.expiryDate, expiredOnOrAfter) : undefined,
          ),
        );
      const availability: Availability[] = [];
      for (const pair of pairs)
        availability.push(await recordSiteAvailability(transaction, pair.productId, pair.siteId));
      return { availability };
    });
    for (const item of availability) await this.publishAvailabilitySafely(item);
    return availability.length;
  }

  /**
   * Goods leave the shelf for a prescription. Each line comes off the batch the pharmacist handed over, which may
   * not be the batch FEFO reserved, so the reservation is released by product (the dispensed batch's hold first) and
   * the on-hand quantity drops on the dispensed batch. Every line writes a `Dispense` ledger entry, and once nothing
   * is held any more the reservation is consumed. A partial dispense keeps the rest of the hold for the next one.
   */
  public async dispense(input: StockDispense): Promise<StockDispenseResult> {
    const dispensedOn = today();
    const { result, availability } = await this.database.db.transaction(async (transaction) => {
      // Claiming the key first makes a concurrent duplicate wait for this transaction, then answer its result.
      const [claimed] = await transaction
        .insert(idempotencyRecords)
        .values({ key: input.dispenseId, scope: DISPENSE_SCOPE, actorId: input.actorId, response: "" })
        .onConflictDoNothing()
        .returning();
      if (!claimed) {
        const [existing] = await transaction
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.scope, DISPENSE_SCOPE),
              eq(idempotencyRecords.key, input.dispenseId),
              eq(idempotencyRecords.actorId, input.actorId),
            ),
          )
          .limit(1);
        return { result: JSON.parse(existing?.response ?? "null") as StockDispenseResult, availability: [] };
      }
      if (input.reservationId) {
        const [reservation] = await transaction
          .select()
          .from(stockReservations)
          .where(eq(stockReservations.id, input.reservationId))
          .for("update");
        if (!reservation || reservation.status !== "active")
          throw new StockDispenseError("The stock reservation for this prescription is no longer active");
      }
      const entries: Array<typeof stockLedgerEntries.$inferSelect> = [];
      const touchedProducts = new Set<string>();
      for (const line of input.lines) {
        const [batch] = await transaction
          .select()
          .from(productBatches)
          .where(eq(productBatches.id, line.productBatchId))
          .limit(1);
        if (!batch || batch.productId !== line.productId)
          throw new StockDispenseError("The dispensed batch does not belong to the prescribed product");
        if (batch.qualityStatus !== "Released")
          throw new StockDispenseError(`Batch ${batch.batchNumber} has not been released by quality control`);
        if (batch.expiryDate < dispensedOn) throw new StockDispenseError(`Batch ${batch.batchNumber} has expired`);
        if (input.reservationId) {
          const holds = await transaction
            .select()
            .from(stockReservationLines)
            .where(
              and(
                eq(stockReservationLines.reservationId, input.reservationId),
                eq(stockReservationLines.productId, line.productId),
                gt(stockReservationLines.quantity, "0"),
              ),
            )
            .for("update");
          holds.sort(
            (left, right) =>
              Number(right.productBatchId === line.productBatchId) -
              Number(left.productBatchId === line.productBatchId),
          );
          let toRelease = line.quantity;
          for (const hold of holds) {
            if (toRelease <= 0) break;
            const released = Math.min(Number(hold.quantity), toRelease);
            toRelease -= released;
            await transaction
              .update(stockReservationLines)
              .set({ quantity: sql`${stockReservationLines.quantity} - ${String(released)}` })
              .where(eq(stockReservationLines.id, hold.id));
            await transaction
              .update(inventoryBalances)
              .set({
                quantityReserved: sql`GREATEST(${inventoryBalances.quantityReserved} - ${String(released)}, 0)`,
                version: sql`${inventoryBalances.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(inventoryBalances.productBatchId, hold.productBatchId),
                  eq(inventoryBalances.storageLocationId, hold.storageLocationId),
                ),
              );
          }
        }
        const [balance] = await transaction
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.productBatchId, line.productBatchId),
              eq(inventoryBalances.storageLocationId, input.storageLocationId),
            ),
          )
          .for("update");
        const available = balance ? Number(balance.quantityOnHand) - Number(balance.quantityReserved) : 0;
        if (!balance || available < line.quantity)
          throw new StockDispenseError(
            `Batch ${batch.batchNumber} has ${available} available at this location, ${line.quantity} were dispensed`,
          );
        const nextOnHand = Number(balance.quantityOnHand) - line.quantity;
        await transaction
          .update(inventoryBalances)
          .set({
            quantityOnHand: String(nextOnHand),
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, balance.id));
        const [entry] = await transaction
          .insert(stockLedgerEntries)
          .values({
            productId: line.productId,
            productBatchId: line.productBatchId,
            siteId: input.siteId,
            storageLocationId: input.storageLocationId,
            quantityDelta: String(-line.quantity),
            quantityAfter: String(nextOnHand),
            movementType: "Dispense",
            referenceType: "Prescription",
            referenceId: input.referenceId,
            reason: `Prescription ${input.referenceId}`,
            createdBy: input.actorId,
          })
          .returning();
        if (!entry) throw new Error("Dispense ledger entry was not saved");
        entries.push(entry);
        touchedProducts.add(line.productId);
      }
      let reservationStatus: string | null = null;
      if (input.reservationId) {
        const [held] = await transaction
          .select({ quantity: sql<string>`coalesce(sum(${stockReservationLines.quantity}), 0)` })
          .from(stockReservationLines)
          .where(eq(stockReservationLines.reservationId, input.reservationId));
        reservationStatus = Number(held?.quantity ?? 0) > 0 ? "active" : "consumed";
        await transaction
          .update(stockReservations)
          .set({ status: reservationStatus, updatedAt: new Date() })
          .where(eq(stockReservations.id, input.reservationId));
      }
      const availability: Availability[] = [];
      for (const productId of touchedProducts)
        availability.push(await recordSiteAvailability(transaction, productId, input.siteId));
      const result: StockDispenseResult = { dispenseId: input.dispenseId, reservationStatus, entries };
      await transaction
        .update(idempotencyRecords)
        .set({ response: JSON.stringify(result) })
        .where(
          and(
            eq(idempotencyRecords.scope, DISPENSE_SCOPE),
            eq(idempotencyRecords.key, input.dispenseId),
            eq(idempotencyRecords.actorId, input.actorId),
          ),
        );
      return { result, availability };
    });
    for (const item of availability) await this.publishAvailabilitySafely(item);
    return result;
  }

  public async listReservations(ownerId?: string) {
    return this.database.db
      .select()
      .from(stockReservations)
      .where(ownerId ? eq(stockReservations.ownerId, ownerId) : undefined)
      .orderBy(asc(stockReservations.createdAt));
  }

  public async listTransfers(siteIds?: string[], status?: string, limit = 100) {
    const conditions = [
      siteIds
        ? or(inArray(transferOrders.sourceSiteId, siteIds), inArray(transferOrders.destinationSiteId, siteIds))
        : undefined,
      status ? eq(transferOrders.status, status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const transfers = await this.database.db
      .select()
      .from(transferOrders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(transferOrders.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    return Promise.all(
      transfers.map(async (transfer) => ({
        ...transfer,
        lines: await this.database.db
          .select()
          .from(transferOrderLines)
          .where(eq(transferOrderLines.transferOrderId, transfer.id)),
      })),
    );
  }

  public async getTransfer(id: string) {
    const transfer = (
      await this.database.db.select().from(transferOrders).where(eq(transferOrders.id, id)).limit(1)
    )[0];
    return transfer
      ? {
          ...transfer,
          lines: await this.database.db
            .select()
            .from(transferOrderLines)
            .where(eq(transferOrderLines.transferOrderId, id)),
        }
      : undefined;
  }

  public async listReplenishments(siteIds?: string[], status?: string, limit = 100) {
    const conditions = [
      siteIds ? inArray(replenishmentRequests.siteId, siteIds) : undefined,
      status ? eq(replenishmentRequests.status, status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const requests = await this.database.db
      .select()
      .from(replenishmentRequests)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(replenishmentRequests.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    return Promise.all(
      requests.map(async (request) => ({
        ...request,
        lines: await this.database.db
          .select()
          .from(replenishmentRequestLines)
          .where(eq(replenishmentRequestLines.replenishmentRequestId, request.id)),
      })),
    );
  }

  public async getReplenishment(id: string) {
    const request = (
      await this.database.db.select().from(replenishmentRequests).where(eq(replenishmentRequests.id, id)).limit(1)
    )[0];
    return request
      ? {
          ...request,
          lines: await this.database.db
            .select()
            .from(replenishmentRequestLines)
            .where(eq(replenishmentRequestLines.replenishmentRequestId, id)),
        }
      : undefined;
  }

  public async transitionReplenishment(
    id: string,
    action: "approve" | "reject" | "cancel" | "fulfill",
    reviewedBy?: string,
    reviewNotes?: string | null,
  ) {
    const result = await this.database.db.transaction(async (transaction) => {
      const current = (
        await transaction
          .select()
          .from(replenishmentRequests)
          .where(eq(replenishmentRequests.id, id))
          .limit(1)
          .for("update")
      )[0];
      if (!current) return undefined;
      const status = transitionReplenishment(current.status as ReplenishmentStatus, action);
      if (action !== "fulfill") {
        const [updated] = await transaction
          .update(replenishmentRequests)
          .set({
            status,
            ...(action === "approve" || action === "reject"
              ? { reviewedBy: reviewedBy ?? null, reviewedAt: new Date(), reviewNotes: reviewNotes ?? null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(replenishmentRequests.id, id))
          .returning();
        return { updated, availability: [] as Availability[] };
      }
      if (!current.storageLocationId) throw new Error("Fulfillment requires a storage location");
      const effectiveLines = await transaction
        .select()
        .from(replenishmentRequestLines)
        .where(eq(replenishmentRequestLines.replenishmentRequestId, id));
      if (effectiveLines.length === 0) throw new Error("Fulfillment requires replenishment lines");
      const availability: Availability[] = [];
      for (const line of effectiveLines) {
        const batchId = line.productBatchId;
        if (!batchId) throw new Error("Fulfillment requires a product batch");
        const batch = (
          await transaction.select().from(productBatches).where(eq(productBatches.id, batchId)).limit(1)
        )[0];
        if (!batch || batch.productId !== line.productId)
          throw new Error("Replenishment batch does not match the requested product");
        const existing = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, batchId),
                eq(inventoryBalances.siteId, current.siteId),
                eq(inventoryBalances.storageLocationId, current.storageLocationId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        const previousOnHand = Number(existing?.quantityOnHand ?? 0);
        const nextOnHand = previousOnHand + Number(line.requestedQuantity);
        const balance = existing
          ? (
              await transaction
                .update(inventoryBalances)
                .set({
                  quantityOnHand: String(nextOnHand),
                  version: sql`${inventoryBalances.version} + 1`,
                  updatedAt: new Date(),
                })
                .where(and(eq(inventoryBalances.id, existing.id), eq(inventoryBalances.version, existing.version)))
                .returning()
            )[0]
          : (
              await transaction
                .insert(inventoryBalances)
                .values({
                  productBatchId: batchId,
                  siteId: current.siteId,
                  storageLocationId: current.storageLocationId,
                  quantityOnHand: String(nextOnHand),
                  quantityReserved: "0",
                })
                .returning()
            )[0];
        if (!balance) throw new Error("Replenishment balance was not saved");
        await transaction.insert(stockLedgerEntries).values({
          productId: line.productId,
          productBatchId: batchId,
          siteId: current.siteId,
          storageLocationId: current.storageLocationId,
          quantityDelta: String(line.requestedQuantity),
          quantityAfter: String(nextOnHand),
          movementType: "Replenishment",
          reason: line.reason ?? `Replenishment request ${id}`,
        });
        availability.push(await recordSiteAvailability(transaction, line.productId, current.siteId));
      }
      const [updated] = await transaction
        .update(replenishmentRequests)
        .set({
          status,
          ...(reviewedBy ? { reviewedBy, reviewedAt: new Date(), reviewNotes: reviewNotes ?? null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(replenishmentRequests.id, id))
        .returning();
      return { updated, availability };
    });
    if (!result) return undefined;
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.updated;
  }

  public async listStocktakes(siteIds?: string[], status?: string, limit = 100) {
    const conditions = [
      siteIds ? inArray(stocktakes.siteId, siteIds) : undefined,
      status ? eq(stocktakes.status, status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const sessions = await this.database.db
      .select()
      .from(stocktakes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stocktakes.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    return Promise.all(
      sessions.map(async (session) => ({
        ...session,
        lines: (
          await this.database.db
            .select({ line: stocktakeLines, batch: productBatches })
            .from(stocktakeLines)
            .innerJoin(productBatches, eq(productBatches.id, stocktakeLines.productBatchId))
            .where(eq(stocktakeLines.stocktakeId, session.id))
        ).map(({ line, batch }) => ({ ...line, productId: batch.productId })),
      })),
    );
  }

  public async getStocktake(id: string) {
    const session = (await this.database.db.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1))[0];
    return session
      ? {
          ...session,
          lines: (
            await this.database.db
              .select({ line: stocktakeLines, batch: productBatches })
              .from(stocktakeLines)
              .innerJoin(productBatches, eq(productBatches.id, stocktakeLines.productBatchId))
              .where(eq(stocktakeLines.stocktakeId, id))
          ).map(({ line, batch }) => ({ ...line, productId: batch.productId })),
        }
      : undefined;
  }

  public async listReturns(siteIds?: string[]) {
    const requests = await this.database.db
      .select()
      .from(returnRequests)
      .where(siteIds ? inArray(returnRequests.siteId, siteIds) : undefined)
      .orderBy(desc(returnRequests.createdAt));
    return Promise.all(
      requests.map(async (request) => ({
        ...request,
        lines: await this.database.db.select().from(returnLines).where(eq(returnLines.returnRequestId, request.id)),
      })),
    );
  }

  public async createTransfer(input: {
    transferNumber: string;
    sourceSiteId: string;
    sourceStorageLocationId?: string | null;
    destinationSiteId: string;
    destinationStorageLocationId?: string | null;
    notes?: string | null;
    createdBy: string;
    lines: Array<{
      productId: string;
      productBatchId?: string | null;
      sourceStorageLocationId?: string | null;
      destinationStorageLocationId?: string | null;
      quantity: number;
      notes?: string | null;
    }>;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const [transfer] = await transaction
        .insert(transferOrders)
        .values({
          transferNumber: input.transferNumber,
          sourceSiteId: input.sourceSiteId,
          sourceStorageLocationId: input.sourceStorageLocationId ?? null,
          destinationSiteId: input.destinationSiteId,
          destinationStorageLocationId: input.destinationStorageLocationId ?? null,
          notes: input.notes ?? null,
          status: "PendingApproval",
          createdBy: input.createdBy,
        })
        .returning();
      if (!transfer) throw new Error("Transfer insert did not return a row");
      await transaction.insert(transferOrderLines).values(
        input.lines.map((line) => ({
          transferOrderId: transfer.id,
          productId: line.productId,
          productBatchId: line.productBatchId ?? null,
          sourceStorageLocationId: line.sourceStorageLocationId ?? input.sourceStorageLocationId ?? null,
          destinationStorageLocationId: line.destinationStorageLocationId ?? input.destinationStorageLocationId ?? null,
          quantity: String(line.quantity),
          requestedQuantity: String(line.quantity),
          notes: line.notes ?? null,
        })),
      );
      return {
        ...transfer,
        lines: await transaction
          .select()
          .from(transferOrderLines)
          .where(eq(transferOrderLines.transferOrderId, transfer.id)),
      };
    });
  }

  public async transitionTransfer(
    id: string,
    action: "approve" | "ship" | "receive" | "cancel",
    lineCommands?: Array<{ transferOrderLineId: string; quantity: number }>,
  ) {
    const result = await this.database.db.transaction(async (transaction) => {
      const current = (
        await transaction.select().from(transferOrders).where(eq(transferOrders.id, id)).limit(1).for("update")
      )[0];
      if (!current) return undefined;
      let status = transitionTransfer(current.status as TransferStatus, action);
      const lines = await transaction
        .select({ line: transferOrderLines, batch: productBatches })
        .from(transferOrderLines)
        .innerJoin(productBatches, eq(productBatches.id, transferOrderLines.productBatchId))
        .where(eq(transferOrderLines.transferOrderId, id));
      const availability: Availability[] = [];
      if (action === "ship") {
        for (const { line, batch } of lines) {
          if (!line.sourceStorageLocationId || !line.productBatchId)
            throw new Error("Transfer source location and batch are required");
          const requested =
            lineCommands?.find((command) => command.transferOrderLineId === line.id)?.quantity ??
            Number(line.quantity) - Number(line.shippedQuantity);
          if (requested <= 0) continue;
          const source = (
            await transaction
              .select()
              .from(inventoryBalances)
              .where(
                and(
                  eq(inventoryBalances.productBatchId, line.productBatchId),
                  eq(inventoryBalances.siteId, current.sourceSiteId),
                  eq(inventoryBalances.storageLocationId, line.sourceStorageLocationId),
                ),
              )
              .limit(1)
              .for("update")
          )[0];
          if (!source || Number(source.quantityOnHand) - Number(source.quantityReserved) < requested)
            throw new Error(`Insufficient stock for transfer product ${batch.productId}`);
          const nextOnHand = Number(source.quantityOnHand) - requested;
          const updated = (
            await transaction
              .update(inventoryBalances)
              .set({
                quantityOnHand: String(nextOnHand),
                version: sql`${inventoryBalances.version} + 1`,
                updatedAt: new Date(),
              })
              .where(and(eq(inventoryBalances.id, source.id), eq(inventoryBalances.version, source.version)))
              .returning()
          )[0];
          if (!updated) throw new Error("Concurrent inventory update detected");
          await transaction
            .update(transferOrderLines)
            .set({ shippedQuantity: sql`${transferOrderLines.shippedQuantity} + ${String(requested)}` })
            .where(eq(transferOrderLines.id, line.id));
          await transaction.insert(stockLedgerEntries).values({
            productId: line.productId,
            productBatchId: line.productBatchId,
            siteId: current.sourceSiteId,
            storageLocationId: line.sourceStorageLocationId,
            quantityDelta: String(-requested),
            quantityAfter: String(nextOnHand),
            movementType: "TransferOut",
            reason: `Transfer ${current.transferNumber}`,
          });
          availability.push(await recordSiteAvailability(transaction, line.productId, current.sourceSiteId));
        }
      }
      if (action === "receive") {
        for (const { line } of lines) {
          if (!line.destinationStorageLocationId || !line.productBatchId)
            throw new Error("Transfer destination location and batch are required");
          const requested =
            lineCommands?.find((command) => command.transferOrderLineId === line.id)?.quantity ??
            Number(line.shippedQuantity) - Number(line.receivedQuantity);
          if (requested <= 0) continue;
          const destination = (
            await transaction
              .select()
              .from(inventoryBalances)
              .where(
                and(
                  eq(inventoryBalances.productBatchId, line.productBatchId),
                  eq(inventoryBalances.siteId, current.destinationSiteId),
                  eq(inventoryBalances.storageLocationId, line.destinationStorageLocationId),
                ),
              )
              .limit(1)
              .for("update")
          )[0];
          const previousOnHand = Number(destination?.quantityOnHand ?? 0);
          const nextOnHand = previousOnHand + requested;
          const balance = destination
            ? (
                await transaction
                  .update(inventoryBalances)
                  .set({
                    quantityOnHand: String(nextOnHand),
                    version: sql`${inventoryBalances.version} + 1`,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(eq(inventoryBalances.id, destination.id), eq(inventoryBalances.version, destination.version)),
                  )
                  .returning()
              )[0]
            : (
                await transaction
                  .insert(inventoryBalances)
                  .values({
                    productBatchId: line.productBatchId,
                    siteId: current.destinationSiteId,
                    storageLocationId: line.destinationStorageLocationId,
                    quantityOnHand: String(nextOnHand),
                    quantityReserved: "0",
                  })
                  .returning()
              )[0];
          if (!balance) throw new Error("Transfer destination balance was not saved");
          await transaction
            .update(transferOrderLines)
            .set({ receivedQuantity: sql`${transferOrderLines.receivedQuantity} + ${String(requested)}` })
            .where(eq(transferOrderLines.id, line.id));
          await transaction.insert(stockLedgerEntries).values({
            productId: line.productId,
            productBatchId: line.productBatchId,
            siteId: current.destinationSiteId,
            storageLocationId: line.destinationStorageLocationId,
            quantityDelta: String(requested),
            quantityAfter: String(nextOnHand),
            movementType: "TransferIn",
            reason: `Transfer ${current.transferNumber}`,
          });
          availability.push(await recordSiteAvailability(transaction, line.productId, current.destinationSiteId));
        }
      }
      if (action === "receive") {
        const refreshedLines = await transaction
          .select()
          .from(transferOrderLines)
          .where(eq(transferOrderLines.transferOrderId, id));
        status = refreshedLines.every((line) => Number(line.receivedQuantity) >= Number(line.shippedQuantity))
          ? "Received"
          : "InTransit";
      }
      const [transfer] = await transaction
        .update(transferOrders)
        .set({
          status,
          ...(action === "approve" ? { approvedBy: current.createdBy, approvedAt: new Date() } : {}),
          ...(action === "ship" ? { shippedAt: new Date() } : {}),
          ...(action === "receive" && status === "Received" ? { receivedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(transferOrders.id, id))
        .returning();
      const detailedTransfer = transfer
        ? {
            ...transfer,
            lines: await transaction
              .select()
              .from(transferOrderLines)
              .where(eq(transferOrderLines.transferOrderId, id)),
          }
        : undefined;
      return { transfer: detailedTransfer, availability };
    });
    if (!result) return undefined;
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.transfer;
  }

  public async createStocktake(input: {
    siteId: string;
    storageLocationId: string;
    notes?: string | null | undefined;
    createdBy: string;
    lines: Array<{ productBatchId: string; systemQuantity?: number | undefined }>;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const [stocktake] = await transaction
        .insert(stocktakes)
        .values({
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          status: "Pending",
          notes: input.notes ?? null,
          createdBy: input.createdBy,
        })
        .returning();
      if (!stocktake) throw new Error("Stocktake insert did not return a row");
      const lines = [];
      for (const line of input.lines ?? []) {
        const balance = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, line.productBatchId),
                eq(inventoryBalances.siteId, input.siteId),
                eq(inventoryBalances.storageLocationId, input.storageLocationId),
              ),
            )
            .limit(1)
        )[0];
        if (!balance) throw new Error(`Inventory balance not found for batch ${line.productBatchId}`);
        lines.push({
          stocktakeId: stocktake.id,
          productBatchId: line.productBatchId,
          systemQuantity: String(balance.quantityOnHand),
        });
      }
      if (lines.length > 0) await transaction.insert(stocktakeLines).values(lines);
      return stocktake;
    });
  }

  public async countStocktakeLine(id: string, countedQuantity: number) {
    const [line] = await this.database.db
      .update(stocktakeLines)
      .set({ countedQuantity: String(countedQuantity), status: "Counted" })
      .where(eq(stocktakeLines.id, id))
      .returning();
    return line;
  }

  public async postStocktake(id: string) {
    const result = await this.database.db.transaction(async (transaction) => {
      const session = (
        await transaction.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1).for("update")
      )[0];
      if (!session) return undefined;
      if (!["Pending", "InProgress"].includes(session.status))
        throw new Error(`Stocktake is already ${session.status}`);
      const lines = await transaction
        .select({ line: stocktakeLines, batch: productBatches })
        .from(stocktakeLines)
        .innerJoin(productBatches, eq(productBatches.id, stocktakeLines.productBatchId))
        .where(eq(stocktakeLines.stocktakeId, id));
      if (lines.length === 0 || lines.some(({ line }) => line.countedQuantity === null))
        throw new Error("All stocktake lines must be counted before posting");
      const availability: Availability[] = [];
      for (const { line, batch } of lines) {
        const countedQuantity = Number(line.countedQuantity);
        const variance = countedQuantity - Number(line.systemQuantity);
        const balance = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, line.productBatchId),
                eq(inventoryBalances.siteId, session.siteId),
                eq(inventoryBalances.storageLocationId, session.storageLocationId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (!balance) throw new Error(`Inventory balance not found for batch ${line.productBatchId}`);
        const quantityReserved = Number(balance.quantityReserved);
        const nextOnHand = Number(balance.quantityOnHand) + variance;
        if (nextOnHand < quantityReserved || nextOnHand < 0)
          throw new Error("Stocktake would make available stock negative");
        if (variance !== 0) {
          const updated = (
            await transaction
              .update(inventoryBalances)
              .set({
                quantityOnHand: String(nextOnHand),
                version: sql`${inventoryBalances.version} + 1`,
                updatedAt: new Date(),
              })
              .where(and(eq(inventoryBalances.id, balance.id), eq(inventoryBalances.version, balance.version)))
              .returning()
          )[0];
          if (!updated) throw new Error("Concurrent inventory update detected");
          await transaction.insert(stockAdjustments).values({
            productId: batch.productId,
            productBatchId: line.productBatchId,
            siteId: session.siteId,
            storageLocationId: session.storageLocationId,
            adjustmentType: variance > 0 ? "Positive" : "Negative",
            quantity: String(Math.abs(variance)),
            reason: "Stocktake variance",
            status: "Approved",
            createdBy: session.createdBy,
            approvedBy: session.createdBy,
            approvalNotes: null,
            notes: null,
            stocktakeSessionId: id,
          });
          await transaction.insert(stockLedgerEntries).values({
            productId: batch.productId,
            productBatchId: line.productBatchId,
            siteId: session.siteId,
            storageLocationId: session.storageLocationId,
            quantityDelta: String(variance),
            quantityAfter: String(nextOnHand),
            movementType: "StocktakeAdjustment",
            reason: `Stocktake ${id}`,
          });
          availability.push(await recordSiteAvailability(transaction, batch.productId, session.siteId));
        }
        await transaction.update(stocktakeLines).set({ status: "Approved" }).where(eq(stocktakeLines.id, line.id));
      }
      const [updatedSession] = await transaction
        .update(stocktakes)
        .set({ status: "Completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(stocktakes.id, id))
        .returning();
      return { session: updatedSession, availability };
    });
    if (!result) return undefined;
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.session;
  }

  public async createReturn(input: {
    siteId: string;
    reason: string;
    createdBy: string;
    lines: Array<{
      productBatchId: string;
      storageLocationId: string;
      quantity: number;
      destination?: string | null | undefined;
      occurredAtUtc?: string | null | undefined;
      notes?: string | null | undefined;
    }>;
  }) {
    const result = await this.database.db.transaction(async (transaction) => {
      const [request] = await transaction
        .insert(returnRequests)
        .values({ siteId: input.siteId, reason: input.reason, status: "Completed", createdBy: input.createdBy })
        .returning();
      if (!request) throw new Error("Return request insert did not return a row");
      const availability: Availability[] = [];
      for (const line of input.lines) {
        const batch = (
          await transaction.select().from(productBatches).where(eq(productBatches.id, line.productBatchId)).limit(1)
        )[0];
        if (!batch) throw new Error(`Product batch ${line.productBatchId} was not found`);
        const balance = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, line.productBatchId),
                eq(inventoryBalances.siteId, input.siteId),
                eq(inventoryBalances.storageLocationId, line.storageLocationId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        if (!balance || Number(balance.quantityOnHand) - Number(balance.quantityReserved) < line.quantity)
          throw new Error("Return quantity exceeds available stock");
        const nextOnHand = Number(balance.quantityOnHand) - line.quantity;
        const updated = (
          await transaction
            .update(inventoryBalances)
            .set({
              quantityOnHand: String(nextOnHand),
              version: sql`${inventoryBalances.version} + 1`,
              updatedAt: new Date(),
            })
            .where(and(eq(inventoryBalances.id, balance.id), eq(inventoryBalances.version, balance.version)))
            .returning()
        )[0];
        if (!updated) throw new Error("Concurrent inventory update detected");
        await transaction.insert(returnLines).values({
          returnRequestId: request.id,
          productBatchId: line.productBatchId,
          storageLocationId: line.storageLocationId,
          quantity: String(line.quantity),
          destination: line.destination ?? null,
          occurredAt: line.occurredAtUtc ? new Date(line.occurredAtUtc) : new Date(),
          notes: line.notes ?? null,
        });
        await transaction.insert(stockLedgerEntries).values({
          productId: batch.productId,
          productBatchId: line.productBatchId,
          siteId: input.siteId,
          storageLocationId: line.storageLocationId,
          quantityDelta: String(-line.quantity),
          quantityAfter: String(nextOnHand),
          movementType: "InventoryReturn",
          reason: input.reason,
          notes: line.notes ?? line.destination ?? null,
          occurredAt: line.occurredAtUtc ? new Date(line.occurredAtUtc) : new Date(),
        });
        availability.push(await recordSiteAvailability(transaction, batch.productId, input.siteId));
      }
      return { request, availability };
    });
    for (const item of result.availability) await this.publishAvailabilitySafely(item);
    return result.request;
  }

  public async createReplenishment(input: {
    siteId: string;
    storageLocationId: string;
    requestedBy: string;
    notes?: string | null;
    lines: Array<{
      productId: string;
      productBatchId?: string | null;
      requestedQuantity: number | string;
      reason?: string | null;
      notes?: string | null;
    }>;
  }) {
    if (input.lines.length === 0) throw new Error("At least one replenishment line is required");
    return this.database.db.transaction(async (transaction) => {
      const [request] = await transaction
        .insert(replenishmentRequests)
        .values({
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          notes: input.notes ?? null,
          requestedBy: input.requestedBy,
        })
        .returning();
      if (!request) throw new Error("Replenishment request insert did not return a row");
      await transaction.insert(replenishmentRequestLines).values(
        input.lines.map((line) => ({
          replenishmentRequestId: request.id,
          productId: line.productId,
          productBatchId: line.productBatchId ?? null,
          requestedQuantity: String(line.requestedQuantity),
          reason: line.reason ?? null,
          notes: line.notes ?? null,
        })),
      );
      return {
        ...request,
        lines: await transaction
          .select()
          .from(replenishmentRequestLines)
          .where(eq(replenishmentRequestLines.replenishmentRequestId, request.id)),
      };
    });
  }
}
