import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";

import { BusinessRuleError } from "../shared/business-rule-error.ts";
import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import {
  inventoryBalances,
  goodsReceiptLines,
  goodsReceipts,
  productBatches,
  purchaseOrderLines,
  purchaseOrders,
  stockLedgerEntries,
} from "../shared/infrastructure/schema.ts";
import { containsPattern, everything, type PageRequest } from "./page-cursor.ts";
import { afterCursor, presentConditions, splitPage, timestampSortValue } from "./keyset-page.ts";
import {
  LEAD_TIME_HISTORY_MONTHS,
  type LeadTimeSample,
  type ProductStockPosition,
} from "./replenishment-suggestions.ts";

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

export type PurchaseOrderInput = {
  purchaseOrderNumber?: string | undefined;
  supplierId: string;
  siteId: string;
  expectedDate?: string | null | undefined;
  createdBy: string;
  notes?: string | null | undefined;
  lines: Array<{ productId: string; orderedQuantity: number; notes?: string | null | undefined }>;
};

type ProcurementTransaction = Parameters<Parameters<InventoryDatabase["db"]["transaction"]>[0]>[0];

/** The number the single-order route has always generated: `PO-<yyyyMMddHHmmss>-<000-999>`. */
const purchaseOrderStamp = (now: Date): string =>
  now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);

const insertPurchaseOrder = async (transaction: ProcurementTransaction, input: PurchaseOrderInput) => {
  const purchaseOrderNumber =
    input.purchaseOrderNumber ??
    `PO-${purchaseOrderStamp(new Date())}-${Math.floor(Math.random() * 1000)
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
};

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

  public async createPurchaseOrder(input: PurchaseOrderInput) {
    return this.database.db.transaction((transaction) => insertPurchaseOrder(transaction, input));
  }

  /**
   * Creates every order in one transaction: all of them are written or none is. Each number is unique within the batch
   * (the sequence of the order in the batch) and across batches (a random suffix), in the shape of a single order's number.
   */
  public async createPurchaseOrders(inputs: Array<Omit<PurchaseOrderInput, "purchaseOrderNumber">>) {
    const stamp = purchaseOrderStamp(new Date());
    return this.database.db.transaction(async (transaction) => {
      const created = [];
      for (const [index, input] of inputs.entries()) {
        const sequence = String(index + 1).padStart(2, "0");
        const suffix = Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0");
        created.push(
          await insertPurchaseOrder(transaction, {
            ...input,
            purchaseOrderNumber: `PO-${stamp}-${sequence}-${suffix}`,
          }),
        );
      }
      return created;
    });
  }

  /**
   * The inputs of the replenishment suggestions for one site (BR-PROC-007), set-based: one row per product that has a
   * balance row at the site or a `Dispense` in the window, with its on hand, reserved, dispensed and open inbound
   * quantities and the supplier of its latest receipt (at the site, else at any site). The lead-time samples are the
   * days from each purchase order's creation to its first receipt, for the orders whose first receipt is within the
   * last 12 months and not before the order.
   */
  public async replenishmentInputs(input: { siteId: string; windowStart: Date; now: Date }): Promise<{
    positions: ProductStockPosition[];
    leadTimeSamples: LeadTimeSample[];
  }> {
    const leadTimeSince = new Date(input.now);
    leadTimeSince.setUTCMonth(leadTimeSince.getUTCMonth() - LEAD_TIME_HISTORY_MONTHS);
    const { rows } = await this.database.db.execute<{
      product_id: string;
      on_hand: string;
      reserved: string;
      dispensed: string;
      inbound: string;
      supplier_id: string | null;
    }>(sql`
      with balance_totals as (
        select ${productBatches.productId} as product_id,
          coalesce(sum(${inventoryBalances.quantityOnHand}), 0) as on_hand,
          coalesce(sum(${inventoryBalances.quantityReserved}), 0) as reserved
        from ${inventoryBalances}
        inner join ${productBatches} on ${productBatches.id} = ${inventoryBalances.productBatchId}
        where ${inventoryBalances.siteId} = ${input.siteId}::uuid
        group by ${productBatches.productId}
      ),
      dispensed_totals as (
        select ${stockLedgerEntries.productId} as product_id,
          coalesce(-sum(${stockLedgerEntries.quantityDelta}), 0) as dispensed
        from ${stockLedgerEntries}
        where ${stockLedgerEntries.siteId} = ${input.siteId}::uuid
          and ${stockLedgerEntries.movementType} = 'Dispense'
          and ${stockLedgerEntries.occurredAt} >= ${input.windowStart.toISOString()}::timestamptz
        group by ${stockLedgerEntries.productId}
      ),
      candidates as (
        select product_id from balance_totals
        union
        select product_id from dispensed_totals
      ),
      inbound_totals as (
        select ${purchaseOrderLines.productId} as product_id,
          coalesce(sum(greatest(${purchaseOrderLines.orderedQuantity} - ${purchaseOrderLines.receivedQuantity}, 0)), 0) as inbound
        from ${purchaseOrderLines}
        inner join ${purchaseOrders} on ${purchaseOrders.id} = ${purchaseOrderLines.purchaseOrderId}
        where ${purchaseOrders.siteId} = ${input.siteId}::uuid
          and ${purchaseOrders.status} in ('Draft', 'Approved', 'PartiallyReceived')
        group by ${purchaseOrderLines.productId}
      ),
      supplier_per_product as (
        select distinct on (${goodsReceiptLines.productId}) ${goodsReceiptLines.productId} as product_id,
          ${goodsReceipts.supplierId} as supplier_id
        from ${goodsReceiptLines}
        inner join ${goodsReceipts} on ${goodsReceipts.id} = ${goodsReceiptLines.goodsReceiptId}
        where ${goodsReceiptLines.productId} in (select product_id from candidates)
        order by ${goodsReceiptLines.productId},
          (${goodsReceipts.siteId} = ${input.siteId}::uuid) desc,
          ${goodsReceipts.receivedAt} desc,
          ${goodsReceipts.id} desc
      )
      select candidates.product_id,
        coalesce(balance_totals.on_hand, 0) as on_hand,
        coalesce(balance_totals.reserved, 0) as reserved,
        coalesce(dispensed_totals.dispensed, 0) as dispensed,
        coalesce(inbound_totals.inbound, 0) as inbound,
        supplier_per_product.supplier_id
      from candidates
      left join balance_totals on balance_totals.product_id = candidates.product_id
      left join dispensed_totals on dispensed_totals.product_id = candidates.product_id
      left join inbound_totals on inbound_totals.product_id = candidates.product_id
      left join supplier_per_product on supplier_per_product.product_id = candidates.product_id
      order by candidates.product_id
    `);
    const { rows: samples } = await this.database.db.execute<{ supplier_id: string; lead_time_days: string }>(sql`
      with first_receipts as (
        select ${goodsReceipts.purchaseOrderId} as purchase_order_id,
          min(${goodsReceipts.receivedAt}) as first_received_at
        from ${goodsReceipts}
        where ${goodsReceipts.purchaseOrderId} is not null
        group by ${goodsReceipts.purchaseOrderId}
      )
      select ${purchaseOrders.supplierId} as supplier_id,
        extract(epoch from (first_receipts.first_received_at - ${purchaseOrders.createdAt})) / 86400 as lead_time_days
      from first_receipts
      inner join ${purchaseOrders} on ${purchaseOrders.id} = first_receipts.purchase_order_id
      where first_receipts.first_received_at >= ${leadTimeSince.toISOString()}::timestamptz
        and first_receipts.first_received_at >= ${purchaseOrders.createdAt}
    `);
    return {
      positions: rows.map((row) => ({
        productId: row.product_id,
        onHand: Number(row.on_hand),
        reserved: Number(row.reserved),
        dispensedQuantity: Number(row.dispensed),
        inboundQuantity: Number(row.inbound),
        supplierId: row.supplier_id,
      })),
      leadTimeSamples: samples.map((row) => ({ supplierId: row.supplier_id, days: Number(row.lead_time_days) })),
    };
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
      unitCost?: number | null | undefined;
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
          unitCost: line.unitCost === undefined || line.unitCost === null ? null : line.unitCost.toFixed(2),
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
      lines: await this.receiptLines(receipt.id),
    };
  }

  /** The lines of a receipt; the cost is a number of dong per unit, or null when it was not recorded. */
  private async receiptLines(goodsReceiptId: string) {
    const lines = await this.database.db
      .select()
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.goodsReceiptId, goodsReceiptId));
    return lines.map((line) => ({ ...line, unitCost: line.unitCost === null ? null : Number(line.unitCost) }));
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
        lines: await this.receiptLines(receipt.id),
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
      lines: await this.receiptLines(id),
    };
  }
}
