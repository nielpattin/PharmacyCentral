import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { BusinessRuleError } from "../shared/business-rule-error.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import {
  goodsReceiptLines,
  goodsReceipts,
  purchaseOrderLines,
  purchaseOrders,
} from "../shared/infrastructure/schema.ts";
import { containsPattern, everything, type PageRequest } from "./page-cursor.ts";
import { afterCursor, presentConditions, splitPage, timestampSortValue } from "./keyset-page.ts";

type InventoryReceipt = {
  productId: string;
  supplierId: string;
  batchNumber: string;
  expiryDate: string;
  manufacturedDate?: string | null | undefined;
  manufacturer?: string | null | undefined;
  siteId: string;
  storageLocationId: string;
  quantity: number;
  actorId: string;
  /** The ledger entry is dated when the goods arrived and points back at its receipt. */
  receivedAt: Date;
  goodsReceiptId: string;
};
type InventoryReceiptHandler = (input: InventoryReceipt) => Promise<void>;

/** Purchase orders are found by their number; the supplier's name lives in catalog-service, not here. */
export type PurchaseOrderFilters = {
  siteIds?: string[] | undefined;
  status?: string | undefined;
  q?: string | undefined;
};
/** Goods receipts are found by their receipt number. */
export type ReceiptFilters = { siteIds?: string[] | undefined; q?: string | undefined };

const purchaseOrderFilters = (filters: PurchaseOrderFilters): Array<SQL | undefined> => [
  filters.siteIds ? inArray(purchaseOrders.siteId, filters.siteIds) : undefined,
  filters.status ? eq(purchaseOrders.status, filters.status) : undefined,
  filters.q ? ilike(purchaseOrders.purchaseOrderNumber, containsPattern(filters.q)) : undefined,
];

const receiptFilters = (filters: ReceiptFilters): Array<SQL | undefined> => [
  filters.siteIds ? inArray(goodsReceipts.siteId, filters.siteIds) : undefined,
  filters.q ? ilike(goodsReceipts.receiptNumber, containsPattern(filters.q)) : undefined,
];

export class ProcurementRepository {
  public constructor(
    private readonly database: InventoryDatabase,
    private readonly receiveInventory?: InventoryReceiptHandler,
  ) {}

  public async listPurchaseOrders(filters: PurchaseOrderFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...purchaseOrderFilters(filters),
      afterCursor({
        sortColumn: purchaseOrders.createdAt,
        idColumn: purchaseOrders.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({ order: purchaseOrders, id: purchaseOrders.id, sortValue: timestampSortValue(purchaseOrders.createdAt) })
      .from(purchaseOrders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ order }) => ({
        ...order,
        lines: await this.database.db
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, order.id)),
      })),
    );
    return { rows, nextCursor };
  }

  public async countPurchaseOrders(filters: PurchaseOrderFilters = {}) {
    const conditions = presentConditions(purchaseOrderFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrders)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
  }

  public async getPurchaseOrder(id: string) {
    const order = (await this.database.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0];
    if (!order) return undefined;
    return {
      ...order,
      lines: await this.database.db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)),
    };
  }

  public async createPurchaseOrder(input: {
    purchaseOrderNumber?: string | undefined;
    supplierId: string;
    siteId: string;
    expectedDate?: string | null | undefined;
    createdBy: string;
    notes?: string | null | undefined;
    lines: Array<{ productId: string; orderedQuantity: number; notes?: string | null | undefined }>;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const purchaseOrderNumber =
        input.purchaseOrderNumber ??
        `PO-${new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14)}-${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0")}`;
      const [order] = await transaction
        .insert(purchaseOrders)
        .values({
          purchaseOrderNumber,
          supplierId: input.supplierId,
          siteId: input.siteId,
          expectedDate: input.expectedDate ?? null,
          createdBy: input.createdBy,
          notes: input.notes ?? null,
        })
        .returning();
      if (!order) throw new Error("Purchase order insert did not return a row");
      const lines = await transaction
        .insert(purchaseOrderLines)
        .values(
          input.lines.map((line) => ({
            purchaseOrderId: order.id,
            productId: line.productId,
            orderedQuantity: line.orderedQuantity,
            receivedQuantity: 0,
            notes: line.notes ?? null,
          })),
        )
        .returning();
      return { ...order, lines };
    });
  }

  public async transition(id: string, action: "approve" | "cancel", actorId: string, notes?: string | null) {
    const current = (await this.database.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).limit(1))[0];
    if (!current) return undefined;
    if (action === "approve" && current.status !== "Draft")
      throw new BusinessRuleError("Only Draft purchase orders can be approved");
    if (action === "cancel" && ["Received", "Cancelled"].includes(current.status))
      throw new BusinessRuleError("Purchase order cannot be cancelled in its current state");
    const now = new Date();
    const [order] = await this.database.db
      .update(purchaseOrders)
      .set({
        status: action === "approve" ? "Approved" : "Cancelled",
        approvedBy: action === "approve" ? actorId : undefined,
        cancelledBy: action === "cancel" ? actorId : undefined,
        approvedAt: action === "approve" ? now : undefined,
        cancelledAt: action === "cancel" ? now : undefined,
        ...(notes === undefined ? {} : { notes: notes ?? null }),
        updatedAt: now,
      })
      .where(eq(purchaseOrders.id, id))
      .returning();
    return order
      ? {
          ...order,
          lines: await this.database.db
            .select()
            .from(purchaseOrderLines)
            .where(eq(purchaseOrderLines.purchaseOrderId, id)),
        }
      : undefined;
  }

  public async createReceipt(input: {
    receiptNumber: string;
    purchaseOrderId?: string | null | undefined;
    supplierId: string;
    siteId: string;
    storageLocationId: string;
    receivedAt: Date;
    createdBy: string;
    notes?: string | null | undefined;
    lines: Array<{
      productId: string;
      batchNumber: string;
      expiryDate: string;
      manufacturedDate?: string | null | undefined;
      manufacturer?: string | null | undefined;
      quantity: number;
      notes?: string | null | undefined;
    }>;
  }) {
    const receipt = await this.database.db.transaction(async (transaction) => {
      if (input.purchaseOrderId) {
        const order = (
          await transaction.select().from(purchaseOrders).where(eq(purchaseOrders.id, input.purchaseOrderId)).limit(1)
        )[0];
        if (!order || !["Approved", "PartiallyReceived"].includes(order.status))
          throw new BusinessRuleError("Purchase order is not receivable");
        const orderedLines = await transaction
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
        for (const line of input.lines) {
          const orderLine = orderedLines.find((candidate) => candidate.productId === line.productId);
          if (!orderLine || orderLine.receivedQuantity + line.quantity > orderLine.orderedQuantity)
            throw new BusinessRuleError("Receipt exceeds ordered quantity");
        }
      }
      const [receipt] = await transaction
        .insert(goodsReceipts)
        .values({
          receiptNumber: input.receiptNumber,
          purchaseOrderId: input.purchaseOrderId ?? null,
          supplierId: input.supplierId,
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          receivedAt: input.receivedAt,
          notes: input.notes ?? null,
          createdBy: input.createdBy,
        })
        .returning();
      if (!receipt) throw new Error("Goods receipt insert did not return a row");
      await transaction.insert(goodsReceiptLines).values(
        input.lines.map((line) => ({
          goodsReceiptId: receipt.id,
          productId: line.productId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate,
          manufacturedDate: line.manufacturedDate ?? null,
          manufacturer: line.manufacturer ?? null,
          quantity: line.quantity,
          notes: line.notes ?? null,
        })),
      );
      if (input.purchaseOrderId) {
        for (const line of input.lines)
          await transaction
            .update(purchaseOrderLines)
            .set({ receivedQuantity: sql`${purchaseOrderLines.receivedQuantity} + ${line.quantity}` })
            .where(
              and(
                eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId),
                eq(purchaseOrderLines.productId, line.productId),
              ),
            );
        const remaining = await transaction
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, input.purchaseOrderId));
        await transaction
          .update(purchaseOrders)
          .set({
            status: remaining.every((line) => line.receivedQuantity === line.orderedQuantity)
              ? "Received"
              : "PartiallyReceived",
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrders.id, input.purchaseOrderId));
      }
      return receipt;
    });
    if (this.receiveInventory)
      for (const line of input.lines)
        await this.receiveInventory({
          ...line,
          supplierId: input.supplierId,
          siteId: input.siteId,
          storageLocationId: input.storageLocationId,
          actorId: input.createdBy,
          receivedAt: receipt.receivedAt,
          goodsReceiptId: receipt.id,
        });
    return {
      ...receipt,
      lines: await this.database.db
        .select()
        .from(goodsReceiptLines)
        .where(eq(goodsReceiptLines.goodsReceiptId, receipt.id)),
    };
  }

  public async listReceipts(filters: ReceiptFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...receiptFilters(filters),
      afterCursor({
        sortColumn: goodsReceipts.receivedAt,
        idColumn: goodsReceipts.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({ receipt: goodsReceipts, id: goodsReceipts.id, sortValue: timestampSortValue(goodsReceipts.receivedAt) })
      .from(goodsReceipts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(goodsReceipts.receivedAt), desc(goodsReceipts.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ receipt }) => ({
        ...receipt,
        lines: await this.database.db
          .select()
          .from(goodsReceiptLines)
          .where(eq(goodsReceiptLines.goodsReceiptId, receipt.id)),
      })),
    );
    return { rows, nextCursor };
  }

  public async countReceipts(filters: ReceiptFilters = {}) {
    const conditions = presentConditions(receiptFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(goodsReceipts)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
  }

  public async getReceipt(id: string) {
    const receipt = (await this.database.db.select().from(goodsReceipts).where(eq(goodsReceipts.id, id)).limit(1))[0];
    if (!receipt) return undefined;
    return {
      ...receipt,
      lines: await this.database.db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.goodsReceiptId, id)),
    };
  }
}
