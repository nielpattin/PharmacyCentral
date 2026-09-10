import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import {
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

export class InventoryRepository {
  public constructor(
    private readonly database: InventoryDatabase,
    private readonly publishAvailability?: (input: {
      productId: string;
      siteId: string;
      inStock: boolean;
    }) => Promise<void>,
  ) {}

  private async publishAvailabilitySafely(
    productId: string,
    siteId: string,
    quantityOnHand: number,
    quantityReserved: number,
  ): Promise<void> {
    if (!this.publishAvailability) return;
    try {
      await this.publishAvailability({ productId, siteId, inStock: quantityOnHand - quantityReserved > 0 });
    } catch {
      // The local stock transaction remains authoritative. The outbox retry handles broker recovery.
    }
  }

  public async listBalances(
    productId?: string,
    siteId?: string,
    storageLocationId?: string,
    includeZeroBalances = true,
  ) {
    const filters = [
      productId ? eq(productBatches.productId, productId) : undefined,
      siteId ? eq(inventoryBalances.siteId, siteId) : undefined,
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
      siteId?: string | undefined;
      storageLocationId?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const conditions = [
      input.productId ? eq(stockLedgerEntries.productId, input.productId) : undefined,
      input.productBatchId ? eq(stockLedgerEntries.productBatchId, input.productBatchId) : undefined,
      input.siteId ? eq(stockLedgerEntries.siteId, input.siteId) : undefined,
      input.storageLocationId ? eq(stockLedgerEntries.storageLocationId, input.storageLocationId) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    return this.database.db
      .select()
      .from(stockLedgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stockLedgerEntries.occurredAt))
      .limit(Math.min(Math.max(input.limit ?? 500, 1), 500));
  }

  public async listAdjustments(
    input: {
      siteId?: string | undefined;
      status?: string | undefined;
      stocktakeSessionId?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const conditions = [
      input.siteId ? eq(stockAdjustments.siteId, input.siteId) : undefined,
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
      await transaction.insert(outboxMessages).values({
        eventType: "inventory.availability.changed.v1",
        schemaVersion: "1",
        payload: JSON.stringify({
          productId: adjustment.productId,
          siteId: adjustment.siteId,
          inStock: nextOnHand - quantityReserved > 0,
        }),
      });
      const [approved] = await transaction
        .update(stockAdjustments)
        .set({ status: "Approved", approvedBy: actorId, approvalNotes: approvalNotes ?? null, updatedAt: new Date() })
        .where(eq(stockAdjustments.id, id))
        .returning();
      return {
        adjustment: approved,
        availability: {
          productId: adjustment.productId,
          siteId: adjustment.siteId,
          quantityOnHand: nextOnHand,
          quantityReserved,
        },
      };
    });
    if (!result) return undefined;
    if (result.availability)
      await this.publishAvailabilitySafely(
        result.availability.productId,
        result.availability.siteId,
        result.availability.quantityOnHand,
        result.availability.quantityReserved,
      );
    return result.adjustment;
  }

  public async createBatch(input: typeof productBatches.$inferInsert) {
    const [batch] = await this.database.db.insert(productBatches).values(input).returning();
    if (!batch) throw new Error("Batch insert did not return a row");
    return batch;
  }

  public async reviewBatch(
    id: string,
    qualityStatus: "Released" | "Rejected",
    qualityNotes?: string | null,
    reviewedBy?: string,
  ) {
    const [batch] = await this.database.db
      .update(productBatches)
      .set({
        qualityStatus,
        qualityNotes: qualityNotes ?? null,
        qualityReviewedBy: reviewedBy ?? null,
        qualityReviewedAt: new Date(),
      })
      .where(eq(productBatches.id, id))
      .returning();
    return batch;
  }

  public async fefoAllocate(input: { productId: string; siteId: string; quantityNeeded: number }) {
    const rows = await this.database.db
      .select({ balance: inventoryBalances, batch: productBatches })
      .from(inventoryBalances)
      .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
      .where(
        and(
          eq(productBatches.productId, input.productId),
          eq(inventoryBalances.siteId, input.siteId),
          eq(productBatches.qualityStatus, "Released"),
        ),
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
      await transaction.insert(outboxMessages).values({
        eventType: "inventory.availability.changed.v1",
        schemaVersion: "1",
        payload: JSON.stringify({
          productId: input.productId,
          siteId: input.siteId,
          inStock: nextOnHand - reserved > 0,
        }),
      });
      return { balance, ledger };
    });
    if (result.balance)
      await this.publishAvailabilitySafely(
        input.productId,
        input.siteId,
        Number(result.balance.quantityOnHand),
        Number(result.balance.quantityReserved),
      );
    return result;
  }

  public async reserve(input: {
    reservationId: string;
    ownerId: string;
    siteId: string;
    storageLocationId: string;
    lines: Array<{ productId: string; quantity: number }>;
  }) {
    return this.database.db.transaction(async (transaction) => {
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
              eq(productBatches.qualityStatus, "Released"),
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
      return allocations;
    });
  }

  public async releaseReservation(id: string, status: "released" | "consumed") {
    return this.database.db.transaction(async (transaction) => {
      const lines = await transaction
        .select()
        .from(stockReservationLines)
        .where(eq(stockReservationLines.reservationId, id));
      if (status === "released") {
        for (const line of lines)
          await transaction
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
            );
      }
      const [reservation] = await transaction
        .update(stockReservations)
        .set({ status, updatedAt: new Date() })
        .where(eq(stockReservations.id, id))
        .returning();
      return reservation;
    });
  }

  public async listReservations(ownerId?: string) {
    return this.database.db
      .select()
      .from(stockReservations)
      .where(ownerId ? eq(stockReservations.ownerId, ownerId) : undefined)
      .orderBy(asc(stockReservations.createdAt));
  }

  public async listTransfers(siteId?: string, status?: string, limit = 100) {
    const conditions = [
      siteId
        ? sql`${transferOrders.sourceSiteId} = ${siteId} OR ${transferOrders.destinationSiteId} = ${siteId}`
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

  public async listReplenishments(siteId?: string, status?: string, limit = 100) {
    const conditions = [
      siteId ? eq(replenishmentRequests.siteId, siteId) : undefined,
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
        return {
          updated,
          availability: [] as Array<{
            productId: string;
            siteId: string;
            quantityOnHand: number;
            quantityReserved: number;
          }>,
        };
      }
      if (!current.storageLocationId) throw new Error("Fulfillment requires a storage location");
      const effectiveLines = await transaction
        .select()
        .from(replenishmentRequestLines)
        .where(eq(replenishmentRequestLines.replenishmentRequestId, id));
      if (effectiveLines.length === 0) throw new Error("Fulfillment requires replenishment lines");
      const availability: Array<{
        productId: string;
        siteId: string;
        quantityOnHand: number;
        quantityReserved: number;
      }> = [];
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
        const quantityReserved = Number(existing?.quantityReserved ?? 0);
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
        await transaction.insert(outboxMessages).values({
          eventType: "inventory.availability.changed.v1",
          schemaVersion: "1",
          payload: JSON.stringify({
            productId: line.productId,
            siteId: current.siteId,
            inStock: nextOnHand - quantityReserved > 0,
          }),
        });
        availability.push({
          productId: line.productId,
          siteId: current.siteId,
          quantityOnHand: nextOnHand,
          quantityReserved,
        });
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
    for (const item of result.availability)
      await this.publishAvailabilitySafely(item.productId, item.siteId, item.quantityOnHand, item.quantityReserved);
    return result.updated;
  }

  public async listStocktakes(siteId?: string, status?: string, limit = 100) {
    const conditions = [
      siteId ? eq(stocktakes.siteId, siteId) : undefined,
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

  public async listReturns(siteId?: string) {
    const requests = await this.database.db
      .select()
      .from(returnRequests)
      .where(siteId ? eq(returnRequests.siteId, siteId) : undefined)
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
      const availability: Array<{
        productId: string;
        siteId: string;
        quantityOnHand: number;
        quantityReserved: number;
      }> = [];
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
          await transaction.insert(outboxMessages).values({
            eventType: "inventory.availability.changed.v1",
            schemaVersion: "1",
            payload: JSON.stringify({
              productId: line.productId,
              siteId: current.sourceSiteId,
              inStock: nextOnHand - Number(updated.quantityReserved) > 0,
            }),
          });
          availability.push({
            productId: line.productId,
            siteId: current.sourceSiteId,
            quantityOnHand: nextOnHand,
            quantityReserved: Number(updated.quantityReserved),
          });
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
          const quantityReserved = Number(destination?.quantityReserved ?? 0);
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
          await transaction.insert(outboxMessages).values({
            eventType: "inventory.availability.changed.v1",
            schemaVersion: "1",
            payload: JSON.stringify({
              productId: line.productId,
              siteId: current.destinationSiteId,
              inStock: nextOnHand - quantityReserved > 0,
            }),
          });
          availability.push({
            productId: line.productId,
            siteId: current.destinationSiteId,
            quantityOnHand: nextOnHand,
            quantityReserved,
          });
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
    for (const item of result.availability)
      await this.publishAvailabilitySafely(item.productId, item.siteId, item.quantityOnHand, item.quantityReserved);
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
      const availability: Array<{
        productId: string;
        siteId: string;
        quantityOnHand: number;
        quantityReserved: number;
      }> = [];
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
          await transaction.insert(outboxMessages).values({
            eventType: "inventory.availability.changed.v1",
            schemaVersion: "1",
            payload: JSON.stringify({
              productId: batch.productId,
              siteId: session.siteId,
              inStock: nextOnHand - quantityReserved > 0,
            }),
          });
        }
        await transaction.update(stocktakeLines).set({ status: "Approved" }).where(eq(stocktakeLines.id, line.id));
        availability.push({
          productId: batch.productId,
          siteId: session.siteId,
          quantityOnHand: nextOnHand,
          quantityReserved,
        });
      }
      const [updatedSession] = await transaction
        .update(stocktakes)
        .set({ status: "Completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(stocktakes.id, id))
        .returning();
      return { session: updatedSession, availability };
    });
    if (!result) return undefined;
    for (const item of result.availability)
      await this.publishAvailabilitySafely(item.productId, item.siteId, item.quantityOnHand, item.quantityReserved);
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
      const availability: Array<{
        productId: string;
        siteId: string;
        quantityOnHand: number;
        quantityReserved: number;
      }> = [];
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
        await transaction.insert(outboxMessages).values({
          eventType: "inventory.availability.changed.v1",
          schemaVersion: "1",
          payload: JSON.stringify({
            productId: batch.productId,
            siteId: input.siteId,
            inStock: nextOnHand - Number(updated.quantityReserved) > 0,
          }),
        });
        availability.push({
          productId: batch.productId,
          siteId: input.siteId,
          quantityOnHand: nextOnHand,
          quantityReserved: Number(updated.quantityReserved),
        });
      }
      return { request, availability };
    });
    for (const item of result.availability)
      await this.publishAvailabilitySafely(item.productId, item.siteId, item.quantityOnHand, item.quantityReserved);
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
