import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { ACTOR_SITE_IDS_HEADER } from "../middleware/trusted-request.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import { auditEvents, financeEntries, projectionCounters, reportRows } from "../shared/infrastructure/schema.ts";

export type IntegrationEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId?: string | undefined;
  payload: Record<string, unknown>;
};
export type OperationsServiceOptions = {
  catalogUrl?: string | undefined;
  inventoryUrl?: string | undefined;
  salesUrl?: string | undefined;
};
export type AuditFilters = {
  limit?: number;
  actorId?: string;
  siteIds?: string[];
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
};

export class OperationsRepository {
  public constructor(
    private readonly database: OperationsDatabase,
    private readonly options: OperationsServiceOptions = {},
  ) {}

  public async apply(event: IntegrationEvent): Promise<boolean> {
    return this.database.db.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(projectionCounters)
        .values({ key: `inbox:${event.eventId}`, value: 1 })
        .onConflictDoNothing()
        .returning();
      if (!inserted[0]) return false;
      await transaction
        .insert(projectionCounters)
        .values({ key: event.eventType, value: 1 })
        .onConflictDoUpdate({
          target: projectionCounters.key,
          set: { value: sql`${projectionCounters.value} + 1`, updatedAt: new Date() },
        });
      const eventDate = new Date(event.occurredAt);
      const payloadJson = JSON.stringify(event.payload);
      if (
        event.eventType.endsWith(".audit.v1") ||
        event.eventType.includes("order") ||
        event.eventType.includes("prescription")
      ) {
        const action = typeof event.payload.action === "string" ? event.payload.action : event.eventType;
        const entityType =
          typeof event.payload.entityType === "string"
            ? event.payload.entityType
            : (event.eventType.split(".")[1] ?? "unknown");
        const entityId =
          firstUuid(event.payload.entityId) ??
          firstUuid(event.payload.orderId) ??
          firstUuid(event.payload.prescriptionId);
        const siteId = firstUuid(event.payload.siteId);
        await transaction
          .insert(auditEvents)
          .values({
            eventId: event.eventId,
            actorId: firstUuid(event.actorId),
            action,
            entityType,
            entityId,
            siteId,
            payload: payloadJson,
            occurredAt: eventDate,
          })
          .onConflictDoNothing();
      }
      const amount = typeof event.payload.amount === "number" ? event.payload.amount : Number(event.payload.amount);
      if (
        Number.isFinite(amount) &&
        (event.eventType.includes("payment.invoice.paid") || event.eventType.includes("payment.invoice.refunded"))
      ) {
        await transaction
          .insert(financeEntries)
          .values({
            eventId: event.eventId,
            entryType: event.eventType.includes("refunded") ? "Refund" : "Payment",
            amount: String(amount),
            currency: typeof event.payload.currency === "string" ? event.payload.currency : "VND",
            payload: payloadJson,
            occurredAt: eventDate,
          })
          .onConflictDoNothing();
      }
      const subjectId =
        firstUuid(event.payload.orderId) ??
        firstUuid(event.payload.productId) ??
        firstUuid(event.payload.prescriptionId);
      await transaction
        .insert(reportRows)
        .values({
          eventId: event.eventId,
          reportType: event.eventType,
          subjectId,
          value: Number.isFinite(amount) ? String(amount) : "0",
          payload: payloadJson,
          occurredAt: eventDate,
        })
        .onConflictDoNothing();
      return true;
    });
  }

  public async listAudit(filters: AuditFilters = {}) {
    const conditions = [
      filters.actorId ? eq(auditEvents.actorId, filters.actorId) : undefined,
      filters.siteIds ? inArray(auditEvents.siteId, filters.siteIds) : undefined,
      filters.action ? ilike(auditEvents.action, `%${filters.action}%`) : undefined,
      filters.entityType ? eq(auditEvents.entityType, filters.entityType) : undefined,
      filters.entityId ? eq(auditEvents.entityId, filters.entityId) : undefined,
      filters.from ? gte(auditEvents.occurredAt, new Date(filters.from)) : undefined,
      filters.to ? lte(auditEvents.occurredAt, new Date(filters.to)) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const rows = await this.database.db
      .select()
      .from(auditEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500));
    return rows.map((row) => ({
      ...row,
      userId: row.actorId,
      entityId: row.entityId,
      summary: null,
      details: row.payload,
      occurredAtUtc: row.occurredAt,
    }));
  }

  public async dashboard(siteIds?: string[]) {
    const rows = await this.database.db.select().from(projectionCounters);
    const live = await this.loadLiveOperations(siteIds);
    // The projection counters span every site, so a site-scoped reader is answered from the live lists alone.
    const counters: Record<string, number> = siteIds ? {} : Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const recentRows = await this.database.db
      .select({ eventId: auditEvents.eventId, eventType: auditEvents.action, occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(siteIds ? inArray(auditEvents.siteId, siteIds) : undefined)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(10);
    const recentActivity = recentRows.map((row) => ({
      ...row,
      id: row.eventId,
      action: row.eventType,
      entityType: row.eventType,
      entityId: null,
      userId: null,
      siteId: null,
      summary: null,
      occurredAtUtc: row.occurredAt,
    }));
    // `/inventory/batches` answers every site, so a scoped reader counts only the batches its own balances hold.
    const expiringBatchCount = siteIds
      ? scopedExpiringBatchCount(live.balances, live.batches)
      : live.batches.filter(isExpiringBatch).length;
    return {
      totalSites: live.sites.length || counters.catalog_sites || 0,
      activeSites: live.sites.filter((site) => site.isActive !== false).length || counters.catalog_active_sites || 0,
      totalStorageLocations: live.locations.length || counters.catalog_storage_locations || 0,
      activeStorageLocations:
        live.locations.filter((location) => location.isActive !== false).length ||
        counters.catalog_active_storage_locations ||
        0,
      totalProducts: live.products.length || counters.catalog_products || 0,
      totalSuppliers: live.suppliers.length || counters.catalog_suppliers || 0,
      totalQuantityOnHand:
        live.balances.reduce((sum, row) => sum + rowQuantity(row, "quantityOnHand"), 0) ||
        counters.inventory_quantity_on_hand ||
        0,
      totalQuantityReserved:
        live.balances.reduce((sum, row) => sum + rowQuantity(row, "quantityReserved"), 0) ||
        counters.inventory_quantity_reserved ||
        0,
      lowStockBatchCount:
        live.balances.filter((row) => rowQuantity(row, "quantityOnHand") - rowQuantity(row, "quantityReserved") <= 10)
          .length ||
        counters.inventory_low_stock_batches ||
        0,
      expiringBatchCount: expiringBatchCount || counters.inventory_expiring_batches || 0,
      pendingTransferCount:
        live.transfers.filter((row) =>
          ["PendingApproval", "Draft", "Approved", "InTransit"].includes(String(row.status)),
        ).length ||
        counters.inventory_pending_transfers ||
        0,
      openPrescriptionCount:
        live.prescriptions.filter((row) => !["Dispensed", "Cancelled"].includes(String(row.status))).length ||
        counters.sales_open_prescriptions ||
        0,
      openStocktakeCount:
        live.stocktakes.filter((row) => !["Completed", "Cancelled"].includes(String(row.status))).length ||
        counters.inventory_open_stocktakes ||
        0,
      pendingAdjustmentCount:
        live.adjustments.filter((row) => row.status === "Pending").length ||
        counters.inventory_pending_adjustments ||
        0,
      recentActivity,
      projectionLag: rows.find((row) => row.key === "projection:last-occurred-at")?.updatedAt ?? null,
    };
  }

  /**
   * Stock is valued at today's published selling price, because the catalog keeps no purchase cost; a batch whose
   * product has no published price is listed as missing a price and adds nothing to the value. The movement figures
   * are the stock ledger of the period, summed by inventory-service.
   */
  public async financeSummary(from?: string, to?: string, siteIds?: string[]) {
    const fromDate = from ?? new Date(0).toISOString();
    const toDate = to ?? new Date().toISOString();
    const period = new URLSearchParams({
      from: new Date(fromDate).toISOString(),
      to: new Date(toDate).toISOString(),
    });
    const [live, movementSummary, prices] = await Promise.all([
      this.loadLiveOperations(siteIds),
      this.fetchRows(this.options.inventoryUrl, `/inventory/movements/summary?${period.toString()}`, siteIds),
      this.fetchRows(this.options.catalogUrl, "/pricing/prices?status=Published&limit=500"),
    ]);
    const conditions = [
      from ? gte(financeEntries.occurredAt, new Date(from)) : undefined,
      to ? lte(financeEntries.occurredAt, new Date(to)) : undefined,
    ].filter((value): value is NonNullable<typeof value> => value !== undefined);
    const entries = await this.database.db
      .select()
      .from(financeEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(financeEntries.occurredAt));
    const paid = entries
      .filter((entry) => entry.entryType === "Payment")
      .reduce((total, entry) => total + Number(entry.amount), 0);
    const refunded = entries
      .filter((entry) => entry.entryType === "Refund")
      .reduce((total, entry) => total + Number(entry.amount), 0);
    // The balances are today's stock, so they are valued at today's prices whatever period the money covers.
    const valuationLines = valueBalances(live, prices, new Date().toISOString().slice(0, 10));
    const movements = new Map(movementSummary.map((row) => [String(row.movementType), row]));
    const moved = (movementType: string, direction: "quantityIn" | "quantityOut"): number =>
      Number(movements.get(movementType)?.[direction] ?? 0);
    return {
      currency: "VND",
      paid,
      refunded,
      net: paid - refunded,
      entries,
      siteId: null,
      from: fromDate,
      to: toDate,
      totalQuantityOnHand: live.balances.reduce((sum, row) => sum + rowQuantity(row, "quantityOnHand"), 0),
      totalQuantityReserved: live.balances.reduce((sum, row) => sum + rowQuantity(row, "quantityReserved"), 0),
      inventoryValue: Math.round(valuationLines.reduce((sum, line) => sum + (line.valueOnHand ?? 0), 0)),
      reservedValue: Math.round(valuationLines.reduce((sum, line) => sum + (line.valueReserved ?? 0), 0)),
      balanceCount: live.balances.length,
      missingPriceCount: valuationLines.filter((line) => line.unitPrice === null).length,
      receiptCount: live.receipts.length,
      receiptQuantity: live.receipts.reduce(
        (sum, receipt) =>
          sum +
          (Array.isArray(receipt.lines)
            ? receipt.lines.reduce(
                (lineSum, line) => lineSum + Number((line as Record<string, unknown>).quantity ?? 0),
                0,
              )
            : 0),
        0,
      ),
      dispensedQuantity: live.prescriptions.reduce(
        (sum, prescription) =>
          sum +
          (Array.isArray(prescription.lines)
            ? prescription.lines.reduce(
                (lineSum, line) => lineSum + Number((line as Record<string, unknown>).dispensedQuantity ?? 0),
                0,
              )
            : 0),
        0,
      ),
      returnQuantity: moved("InventoryReturn", "quantityOut"),
      adjustmentQuantity: ["StockAdjustment", "StocktakeAdjustment", "Adjustment"].reduce(
        (sum, movementType) => sum + moved(movementType, "quantityIn") - moved(movementType, "quantityOut"),
        0,
      ),
      transferOutQuantity: moved("TransferOut", "quantityOut"),
      transferInQuantity: moved("TransferIn", "quantityIn"),
      valuationLines,
      activityLines: movementSummary.map((row) => ({
        activityType: row.movementType,
        count: row.count,
        quantityIn: row.quantityIn,
        quantityOut: row.quantityOut,
        latestActivityAtUtc: row.latestOccurredAt,
      })),
    };
  }

  public async report(reportType?: string, limit = 100) {
    return this.database.db
      .select()
      .from(reportRows)
      .where(reportType ? eq(reportRows.reportType, reportType) : undefined)
      .orderBy(desc(reportRows.occurredAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  }

  /**
   * Reads the other services as the caller would: `siteIds` is forwarded as the actor's site scope, so every
   * site-bound list answers only those sites and the totals never count another pharmacy's stock.
   */
  private async loadLiveOperations(siteIds?: string[]): Promise<LiveOperations> {
    const [
      sites,
      locations,
      products,
      suppliers,
      balances,
      batches,
      transfers,
      stocktakes,
      adjustments,
      receipts,
      prescriptions,
    ] = await Promise.all([
      this.fetchRows(this.options.catalogUrl, "/sites"),
      this.fetchRows(this.options.catalogUrl, "/storage-locations", siteIds),
      // The catalog caps one page of products at 100; a larger limit is refused with 400 and the list comes back empty.
      this.fetchRows(this.options.catalogUrl, "/products?limit=100"),
      this.fetchRows(this.options.catalogUrl, "/suppliers"),
      this.fetchRows(this.options.inventoryUrl, "/inventory/balances", siteIds),
      this.fetchRows(this.options.inventoryUrl, "/inventory/batches"),
      this.fetchRows(this.options.inventoryUrl, "/inventory/transfers", siteIds),
      this.fetchRows(this.options.inventoryUrl, "/inventory/stocktakes", siteIds),
      this.fetchRows(this.options.inventoryUrl, "/inventory/adjustments", siteIds),
      this.fetchRows(this.options.inventoryUrl, "/procurement/goods-receipts", siteIds),
      this.fetchRows(this.options.salesUrl, "/prescriptions", siteIds),
    ]);
    return {
      sites: siteIds ? sites.filter((site) => siteIds.includes(String(site.id))) : sites,
      // The scope header is not the only line of defense: a service behind us could answer every location.
      locations: siteIds ? locations.filter((location) => siteIds.includes(String(location.siteId))) : locations,
      products,
      suppliers,
      balances,
      batches,
      transfers,
      stocktakes,
      adjustments,
      receipts,
      prescriptions,
    };
  }

  /**
   * A site-bound read belongs to a scoped reader, and swallowing its failure would report a dashboard with no stock
   * or no takings as if that were the truth, so a scoped read throws and the route answers 5xx. The unscoped reader
   * keeps the lenient behavior: a network-wide dashboard is still useful without one list.
   */
  private async fetchRows(
    baseUrl: string | undefined,
    path: string,
    siteIds?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (!baseUrl) return [];
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          ...internalServiceHeaders(),
          ...(siteIds ? { [ACTOR_SITE_IDS_HEADER]: siteIds.join(",") } : {}),
        },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        if (siteIds) throw new Error(`Scoped read of ${path} answered HTTP ${response.status}`);
        return [];
      }
      const value = (await response.json()) as unknown;
      if (!Array.isArray(value)) {
        if (siteIds) throw new Error(`Scoped read of ${path} did not answer a list`);
        return [];
      }
      return value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
    } catch (error) {
      if (siteIds) throw error;
      return [];
    }
  }
}

type LiveOperations = {
  sites: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  balances: Array<Record<string, unknown>>;
  batches: Array<Record<string, unknown>>;
  transfers: Array<Record<string, unknown>>;
  stocktakes: Array<Record<string, unknown>>;
  adjustments: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  prescriptions: Array<Record<string, unknown>>;
};

const rowQuantity = (row: Record<string, unknown>, key: string): number => {
  const direct = row[key];
  if (typeof direct === "number" || typeof direct === "string") return Number(direct);
  const balance = row.balance;
  if (balance && typeof balance === "object" && key in balance)
    return Number((balance as Record<string, unknown>)[key]);
  return 0;
};

const isExpiringBatch = (row: Record<string, unknown>): boolean =>
  typeof row.expiryDate === "string" && new Date(row.expiryDate).getTime() <= Date.now() + 30 * 86400000;

/**
 * `inventory-service` joins the batch onto every balance row (`GET /inventory/balances` answers `{ balance, batch }`),
 * so the batch a site holds is readable from either side of the row. A row that carries neither id contributes no
 * batch, which keeps a scoped count at zero rather than guessing.
 */
const balanceBatchId = (row: Record<string, unknown>): string | null => {
  const batch = row.batch;
  if (batch && typeof batch === "object") {
    const id = (batch as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  const balance = row.balance;
  if (balance && typeof balance === "object") {
    const id = (balance as Record<string, unknown>).productBatchId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
};

const scopedExpiringBatchCount = (
  balances: Array<Record<string, unknown>>,
  batches: Array<Record<string, unknown>>,
): number => {
  const referenced = new Set(balances.map(balanceBatchId).filter((id): id is string => id !== null));
  return batches.filter((row) => typeof row.id === "string" && referenced.has(row.id) && isExpiringBatch(row)).length;
};

const firstUuid = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;

type ValuationLine = {
  productId: string | null;
  productName: string;
  batchNumber: string | null;
  siteId: string | null;
  siteName: string;
  quantityOnHand: number;
  quantityReserved: number;
  unitPrice: number | null;
  valueOnHand: number | null;
  valueReserved: number | null;
  priceStatus: "Priced" | "Missing price";
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * Price of one base unit of every product on `day`. A published price is per sale unit while stock is counted in base
 * units, so each price is divided by its unit's conversion factor; the base unit's own price wins over a larger
 * unit's. A price whose unit the product list does not carry cannot be converted and is skipped.
 */
const basePricesOn = (
  products: Array<Record<string, unknown>>,
  prices: Array<Record<string, unknown>>,
  day: string,
): Map<string, number> => {
  const units = new Map<string, { factor: number; isBase: boolean }>();
  for (const product of products) {
    for (const unit of Array.isArray(product.units) ? product.units.map(asRecord) : []) {
      const factor = Number(unit.conversionFactorToBaseUnit);
      if (typeof unit.id === "string" && factor > 0) units.set(unit.id, { factor, isBase: unit.isBaseUnit === true });
    }
  }
  const chosen = new Map<string, { price: number; isBase: boolean }>();
  for (const price of prices) {
    const effectiveTo = typeof price.effectiveTo === "string" ? price.effectiveTo : null;
    if (String(price.effectiveFrom) > day || (effectiveTo !== null && effectiveTo < day)) continue;
    const unit = units.get(String(price.productUnitId));
    const amount = Number(price.unitPrice);
    if (!unit || !Number.isFinite(amount)) continue;
    const productId = String(price.productId);
    const current = chosen.get(productId);
    if (!current || (unit.isBase && !current.isBase)) {
      chosen.set(productId, { price: amount / unit.factor, isBase: unit.isBase });
    }
  }
  return new Map([...chosen].map(([productId, entry]) => [productId, entry.price]));
};

/** One valuation line per stocked balance row; an empty row has nothing to value and is left out. */
const valueBalances = (live: LiveOperations, prices: Array<Record<string, unknown>>, day: string): ValuationLine[] => {
  const basePrices = basePricesOn(live.products, prices, day);
  const productNames = new Map(live.products.map((product) => [String(product.id), String(product.name)]));
  const siteNames = new Map(live.sites.map((site) => [String(site.id), String(site.name)]));
  return live.balances
    .filter((row) => rowQuantity(row, "quantityOnHand") > 0)
    .map((row) => {
      const balance = asRecord(row.balance);
      const batch = asRecord(row.batch);
      const productId = typeof batch.productId === "string" ? batch.productId : null;
      const siteId = typeof balance.siteId === "string" ? balance.siteId : null;
      const unitPrice = productId === null ? null : (basePrices.get(productId) ?? null);
      const quantityOnHand = rowQuantity(row, "quantityOnHand");
      const quantityReserved = rowQuantity(row, "quantityReserved");
      return {
        productId,
        productName: (productId === null ? undefined : productNames.get(productId)) ?? productId ?? "-",
        batchNumber: typeof batch.batchNumber === "string" ? batch.batchNumber : null,
        siteId,
        siteName: (siteId === null ? undefined : siteNames.get(siteId)) ?? siteId ?? "-",
        quantityOnHand,
        quantityReserved,
        unitPrice,
        valueOnHand: unitPrice === null ? null : Math.round(quantityOnHand * unitPrice),
        valueReserved: unitPrice === null ? null : Math.round(quantityReserved * unitPrice),
        priceStatus: unitPrice === null ? "Missing price" : "Priced",
      };
    });
};
