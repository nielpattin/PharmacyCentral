import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
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
  siteId?: string;
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
      filters.siteId ? eq(auditEvents.siteId, filters.siteId) : undefined,
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

  public async dashboard(siteId?: string) {
    const rows = await this.database.db.select().from(projectionCounters);
    const live = await this.loadLiveOperations(siteId);
    const counters = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const recentRows = await this.database.db
      .select({ eventId: auditEvents.eventId, eventType: auditEvents.action, occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
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
      expiringBatchCount:
        live.batches.filter(
          (row) =>
            typeof row.expiryDate === "string" && new Date(row.expiryDate).getTime() <= Date.now() + 30 * 86400000,
        ).length ||
        counters.inventory_expiring_batches ||
        0,
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

  public async financeSummary(from?: string, to?: string, siteId?: string) {
    const live = await this.loadLiveOperations(siteId);
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
    const fromDate = from ?? new Date(0).toISOString();
    const toDate = to ?? new Date().toISOString();
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
      inventoryValue: 0,
      reservedValue: 0,
      balanceCount: live.balances.length,
      missingPriceCount: 0,
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
      returnQuantity: 0,
      adjustmentQuantity: 0,
      transferOutQuantity: 0,
      transferInQuantity: 0,
      valuationLines: [],
      activityLines: [],
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

  private async loadLiveOperations(siteId?: string): Promise<LiveOperations> {
    const query = siteId ? `?siteId=${encodeURIComponent(siteId)}` : "";
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
      this.fetchRows(this.options.catalogUrl, `/storage-locations${query}`),
      this.fetchRows(this.options.catalogUrl, "/products?limit=500"),
      this.fetchRows(this.options.catalogUrl, "/suppliers"),
      this.fetchRows(this.options.inventoryUrl, `/inventory/balances${query}`),
      this.fetchRows(this.options.inventoryUrl, "/inventory/batches"),
      this.fetchRows(this.options.inventoryUrl, `/inventory/transfers${query}`),
      this.fetchRows(this.options.inventoryUrl, `/inventory/stocktakes${query}`),
      this.fetchRows(this.options.inventoryUrl, `/inventory/adjustments${query}`),
      this.fetchRows(this.options.inventoryUrl, `/procurement/goods-receipts${query}`),
      this.fetchRows(this.options.salesUrl, `/prescriptions${query}`),
    ]);
    return {
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
    };
  }

  private async fetchRows(baseUrl: string | undefined, path: string): Promise<Array<Record<string, unknown>>> {
    if (!baseUrl) return [];
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: internalServiceHeaders(),
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return [];
      const value = (await response.json()) as unknown;
      if (!Array.isArray(value)) return [];
      return value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
    } catch {
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

const firstUuid = (value: unknown): string | null =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
