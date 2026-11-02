import { and, desc, eq, getTableColumns, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { ACTOR_SITE_IDS_HEADER } from "../middleware/trusted-request.ts";
import { internalServiceHeaders } from "../internal-service-headers.ts";

import type { OperationsDatabase } from "../shared/infrastructure/database.ts";
import { auditEvents, financeEntries, projectionCounters, reportRows } from "../shared/infrastructure/schema.ts";
import type { z } from "zod";
import {
  basePricesAnswerSchema,
  buildAnalyticsSection,
  buildSalesTargetsReport,
  customerFirstPaidAnswerSchema,
  dispenseCostsAnswerSchema,
  paidInvoicesAnswerSchema,
  previousPeriodOf,
  productClassificationsAnswerSchema,
  salesDocumentsAnswerSchema,
  joinSales,
  salesTargetsAnswerSchema,
  sitesAnswerSchema,
  stockHealthAnswerSchema,
  type AnalyticsChannel,
  type AnalyticsSection,
  type DashboardAnalytics,
  type Period,
  type SalesTargetsReport,
} from "./analytics.ts";
import type { PageCursor } from "./page-cursor.ts";

export type IntegrationEvent = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId?: string | undefined;
  payload: Record<string, unknown>;
};
/** The asking employee's `Authorization` value for catalog-service; called for each catalog read. */
export type CatalogIdentity = () => string;

export type OperationsServiceOptions = {
  catalogUrl?: string | undefined;
  inventoryUrl?: string | undefined;
  salesUrl?: string | undefined;
  paymentUrl?: string | undefined;
};
export type AuditFilters = {
  limit?: number;
  cursor?: PageCursor;
  /** Case-insensitive substring over the action, the entity type, the entity id and the actor id. */
  q?: string;
  actorId?: string;
  siteIds?: string[];
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
};

/** One keyset page: its rows, and the position after the last of them when another row follows. */
export type KeysetPage<Row> = { rows: Row[]; next: PageCursor | undefined };

export type ReportRow = typeof reportRows.$inferSelect;
export type AuditRow = typeof auditEvents.$inferSelect & {
  userId: string | null;
  summary: null;
  details: string;
  occurredAtUtc: Date;
};

export type AnalyticsQuery = {
  /** The tab to answer; the other tabs are neither read nor computed. */
  section: AnalyticsSection;
  from: Date;
  to: Date;
  siteId?: string | undefined;
  channel: AnalyticsChannel;
};

/** A read of an owning service answered an error. `code` is the owner's code when its answer names one. */
export class AnalyticsReadError extends Error {
  public constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly code: string | undefined,
  ) {
    super(`Analytics read of ${path} answered HTTP ${status}`);
  }
}

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
/** The analytics reads cover whole periods, so they wait longer than the dashboard's 2-second reads. */
const ANALYTICS_READ_TIMEOUT_MS = 15_000;

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
            // The publisher of an audit event names the actor on the envelope; the older sales events carry it in the payload.
            actorId: firstUuid(event.actorId) ?? firstUuid(event.payload.actorId),
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
      // An audit event is a record of who did what, shown in the audit log; it is not a figure for a report.
      if (!event.eventType.endsWith(".audit.v1"))
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

  /** Newest first by `(occurredAt, eventId)`: one keyset page of at most `limit` rows, the default 100. */
  public async listAudit(filters: AuditFilters = {}): Promise<KeysetPage<AuditRow>> {
    const limit = Math.min(Math.max(Math.floor(filters.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    // `%` and `_` in the text match themselves; Postgres ILIKE escapes with backslash.
    const pattern = filters.q ? `%${filters.q.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : undefined;
    const conditions = [
      filters.actorId ? eq(auditEvents.actorId, filters.actorId) : undefined,
      filters.siteIds ? inArray(auditEvents.siteId, filters.siteIds) : undefined,
      filters.action ? ilike(auditEvents.action, `%${filters.action}%`) : undefined,
      filters.entityType ? eq(auditEvents.entityType, filters.entityType) : undefined,
      filters.entityId ? eq(auditEvents.entityId, filters.entityId) : undefined,
      filters.from ? gte(auditEvents.occurredAt, new Date(filters.from)) : undefined,
      filters.to ? lte(auditEvents.occurredAt, new Date(filters.to)) : undefined,
      pattern
        ? or(
            ilike(auditEvents.action, pattern),
            ilike(auditEvents.entityType, pattern),
            sql`${auditEvents.entityId}::text ilike ${pattern}`,
            sql`${auditEvents.actorId}::text ilike ${pattern}`,
          )
        : undefined,
      filters.cursor
        ? sql`(${auditEvents.occurredAt}, ${auditEvents.eventId}) < (${filters.cursor.sortAt}::timestamptz, ${filters.cursor.id}::uuid)`
        : undefined,
    ].filter((condition): condition is SQL => condition !== undefined);
    const fetched = await this.database.db
      .select({
        ...getTableColumns(auditEvents),
        sortAt: sql<string>`to_char(${auditEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(auditEvents)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.eventId))
      .limit(limit + 1);
    const visible = fetched.slice(0, limit);
    const last = visible.at(-1);
    return {
      rows: visible.map(({ sortAt: _sortAt, ...row }) => ({
        ...row,
        userId: row.actorId,
        summary: null,
        details: row.payload,
        occurredAtUtc: row.occurredAt,
      })),
      next: fetched.length > limit && last ? { sortAt: last.sortAt, id: last.eventId } : undefined,
    };
  }

  public async dashboard(catalogIdentity: CatalogIdentity, siteIds?: string[]) {
    const rows = await this.database.db.select().from(projectionCounters);
    const live = await this.loadLiveOperations(catalogIdentity, siteIds);
    const counts = await this.loadCounts(siteIds);
    // The projection counters span every site, so a site-scoped reader is answered from the live reads alone, and a
    // network-wide reader falls back to them only when the owning service did not answer its count.
    const counters: Record<string, number> = siteIds ? {} : Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const recentRows = await this.database.db
      .select({
        eventId: auditEvents.eventId,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        actorId: auditEvents.actorId,
        siteId: auditEvents.siteId,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(siteIds ? inArray(auditEvents.siteId, siteIds) : undefined)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(10);
    const recentActivity = recentRows.map(({ actorId, ...row }) => ({
      ...row,
      id: row.eventId,
      eventType: row.action,
      userId: actorId,
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
      totalProducts: counts.products ?? counters.catalog_products ?? 0,
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
      pendingTransferCount: counts.pendingTransfers ?? counters.inventory_pending_transfers ?? 0,
      openPrescriptionCount: counts.openPrescriptions ?? counters.sales_open_prescriptions ?? 0,
      openStocktakeCount: counts.openStocktakes ?? counters.inventory_open_stocktakes ?? 0,
      pendingAdjustmentCount: counts.pendingAdjustments ?? counters.inventory_pending_adjustments ?? 0,
      recentActivity,
      projectionLag: rows.find((row) => row.key === "projection:last-occurred-at")?.updatedAt ?? null,
    };
  }

  /**
   * Stock is valued at today's published selling price, because the catalog keeps no purchase cost; a batch whose
   * product has no published price is listed as missing a price and adds nothing to the value. The movement figures
   * are the stock ledger of the period, summed by inventory-service.
   */
  public async financeSummary(catalogIdentity: CatalogIdentity, from?: string, to?: string, siteIds?: string[]) {
    const fromDate = from ?? new Date(0).toISOString();
    const toDate = to ?? new Date().toISOString();
    const period = new URLSearchParams({
      from: new Date(fromDate).toISOString(),
      to: new Date(toDate).toISOString(),
    });
    const today = new Date().toISOString().slice(0, 10);
    const [live, counts, movementSummary, allTimeMovements, prices] = await Promise.all([
      this.loadLiveOperations(catalogIdentity, siteIds),
      this.loadCounts(siteIds),
      this.fetchRows(this.options.inventoryUrl, `/inventory/movements/summary?${period.toString()}`, siteIds),
      this.fetchRows(this.options.inventoryUrl, "/inventory/movements/summary", siteIds),
      this.fetchRows(this.options.catalogUrl, `/pricing/base-prices?day=${today}`),
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
    const valuationLines = valueBalances(live, prices);
    const movements = new Map(movementSummary.map((row) => [String(row.movementType), row]));
    const moved = (movementType: string, direction: "quantityIn" | "quantityOut"): number =>
      Number(movements.get(movementType)?.[direction] ?? 0);
    // Received and dispensed quantities are all-time figures, as they always were, read from the stock ledger.
    const allTime = new Map(allTimeMovements.map((row) => [String(row.movementType), row]));
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
      receiptCount: counts.receipts ?? 0,
      receiptQuantity: Number(allTime.get("GoodsReceipt")?.quantityIn ?? 0),
      dispensedQuantity: Number(allTime.get("Dispense")?.quantityOut ?? 0),
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

  /**
   * One tab of the period analytics of design 0007. The reads are those of the asked tab alone, so the page never waits
   * for, nor pays for, a figure it is not showing. Every read is strict: a failed or malformed answer throws, so the
   * page shows an error rather than figures that leave a service out. `siteIds` is the caller's site scope, which the
   * site-bound reads receive as `x-actor-site-ids`, as the existing scoped reads do.
   */
  public async dashboardAnalytics(
    query: AnalyticsQuery,
    catalogIdentity: CatalogIdentity,
    siteIds: string[] | undefined,
    now = new Date(),
  ): Promise<DashboardAnalytics> {
    const period: Period = { from: query.from, to: query.to };
    const siteHeaders = siteIds ? { [ACTOR_SITE_IDS_HEADER]: siteIds.join(",") } : {};
    const currentWindow = new URLSearchParams({ from: period.from.toISOString(), to: period.to.toISOString() });
    const base = {
      now,
      period,
      siteId: query.siteId ?? null,
      scope: siteIds,
      channel: query.channel,
    };
    const sites = () =>
      this.readAnswer(this.options.catalogUrl, "/sites", { authorization: catalogIdentity() }, sitesAnswerSchema);
    switch (query.section) {
      case "overview": {
        // The tiles compare with the previous period, so the sales and their costs start there; the tab needs nothing else.
        const previous = previousPeriodOf(period);
        const salesWindow = new URLSearchParams({ from: previous.from.toISOString(), to: period.to.toISOString() });
        const sinceWindow = new URLSearchParams({ since: previous.from.toISOString() });
        const [documents, invoices, costs] = await Promise.all([
          this.readAnswer(
            this.options.salesUrl,
            `/internal/analytics/sales-documents?${salesWindow.toString()}`,
            { ...internalServiceHeaders(), ...siteHeaders },
            salesDocumentsAnswerSchema,
          ),
          this.readAnswer(
            this.options.paymentUrl,
            `/internal/analytics/paid-invoices?${sinceWindow.toString()}`,
            internalServiceHeaders(),
            paidInvoicesAnswerSchema,
          ),
          this.readAnswer(
            this.options.inventoryUrl,
            `/internal/analytics/dispense-costs?${sinceWindow.toString()}`,
            internalServiceHeaders(),
            dispenseCostsAnswerSchema,
          ),
        ]);
        return buildAnalyticsSection({
          ...base,
          section: "overview",
          documents: documents.documents,
          invoices: invoices.invoices,
          dispenseCosts: costs.rows,
        });
      }
      case "revenue": {
        // The breakdown divides the current period alone: a sale is bucketed by the document's own creation date.
        const sinceWindow = new URLSearchParams({ since: period.from.toISOString() });
        const [documents, invoices, products, siteNames] = await Promise.all([
          this.readAnswer(
            this.options.salesUrl,
            `/internal/analytics/sales-documents?${currentWindow.toString()}`,
            { ...internalServiceHeaders(), ...siteHeaders },
            salesDocumentsAnswerSchema,
          ),
          this.readAnswer(
            this.options.paymentUrl,
            `/internal/analytics/paid-invoices?${sinceWindow.toString()}`,
            internalServiceHeaders(),
            paidInvoicesAnswerSchema,
          ),
          this.readAnswer(
            this.options.catalogUrl,
            "/internal/analytics/products",
            internalServiceHeaders(),
            productClassificationsAnswerSchema,
          ),
          sites(),
        ]);
        return buildAnalyticsSection({
          ...base,
          section: "revenue",
          documents: documents.documents,
          invoices: invoices.invoices,
          products: products.products,
          sites: siteNames,
        });
      }
      case "customers": {
        const sinceWindow = new URLSearchParams({ since: period.from.toISOString() });
        const [documents, invoices, customerFirstPaid] = await Promise.all([
          this.readAnswer(
            this.options.salesUrl,
            `/internal/analytics/sales-documents?${currentWindow.toString()}`,
            { ...internalServiceHeaders(), ...siteHeaders },
            salesDocumentsAnswerSchema,
          ),
          this.readAnswer(
            this.options.paymentUrl,
            `/internal/analytics/paid-invoices?${sinceWindow.toString()}`,
            internalServiceHeaders(),
            paidInvoicesAnswerSchema,
          ),
          this.readAnswer(
            this.options.salesUrl,
            `/internal/analytics/customer-first-paid?${currentWindow.toString()}`,
            { ...internalServiceHeaders(), ...siteHeaders },
            customerFirstPaidAnswerSchema,
          ),
        ]);
        return buildAnalyticsSection({
          ...base,
          section: "customers",
          documents: documents.documents,
          invoices: invoices.invoices,
          customerFirstPaid: customerFirstPaid.customers,
        });
      }
      case "inventory": {
        // Stock health takes no sales read: it counts the stock of the period and values it at today's base prices.
        const today = now.toISOString().slice(0, 10);
        const [stock, prices, siteNames] = await Promise.all([
          this.readAnswer(
            this.options.inventoryUrl,
            `/internal/analytics/stock-health?${currentWindow.toString()}`,
            { ...internalServiceHeaders(), ...siteHeaders },
            stockHealthAnswerSchema,
          ),
          this.readAnswer(
            this.options.catalogUrl,
            `/pricing/base-prices?day=${today}`,
            internalServiceHeaders(),
            basePricesAnswerSchema,
          ),
          sites(),
        ]);
        return buildAnalyticsSection({
          ...base,
          section: "inventory",
          stockRows: stock.rows,
          basePrices: prices,
          sites: siteNames,
        });
      }
    }
  }

  /**
   * One month's revenue against the targets of the caller's sites (design 0007). The targets come from sales-service,
   * the revenue from the same paid-invoice join as Analytics, and the site names from catalog-service. A failed read
   * throws, so the section shows an error rather than a target without its revenue.
   */
  public async salesTargetsReport(
    query: { month: string; from: Date; to: Date; siteId?: string | undefined },
    catalogIdentity: CatalogIdentity,
    siteIds: string[] | undefined,
  ): Promise<SalesTargetsReport> {
    const period: Period = { from: query.from, to: query.to };
    const siteHeaders = siteIds ? { [ACTOR_SITE_IDS_HEADER]: siteIds.join(",") } : {};
    const documentWindow = new URLSearchParams({ from: period.from.toISOString(), to: period.to.toISOString() });
    const invoiceWindow = new URLSearchParams({ since: period.from.toISOString() });
    const targetWindow = new URLSearchParams({ month: query.month });
    const [documents, invoices, targets, sites] = await Promise.all([
      this.readAnswer(
        this.options.salesUrl,
        `/internal/analytics/sales-documents?${documentWindow.toString()}`,
        { ...internalServiceHeaders(), ...siteHeaders },
        salesDocumentsAnswerSchema,
      ),
      this.readAnswer(
        this.options.paymentUrl,
        `/internal/analytics/paid-invoices?${invoiceWindow.toString()}`,
        internalServiceHeaders(),
        paidInvoicesAnswerSchema,
      ),
      this.readAnswer(
        this.options.salesUrl,
        `/internal/analytics/sales-targets?${targetWindow.toString()}`,
        { ...internalServiceHeaders(), ...siteHeaders },
        salesTargetsAnswerSchema,
      ),
      this.readAnswer(this.options.catalogUrl, "/sites", { authorization: catalogIdentity() }, sitesAnswerSchema),
    ]);
    return buildSalesTargetsReport({
      month: query.month,
      period,
      siteId: query.siteId ?? null,
      scope: siteIds,
      sites,
      targets: targets.targets,
      sales: joinSales(documents.documents, invoices.invoices),
    });
  }

  /** Newest first by `(occurredAt, id)`: one keyset page of at most `limit` rows, the default 100. */
  public async report(
    reportType: string | undefined,
    options: { limit?: number; cursor?: PageCursor } = {},
  ): Promise<KeysetPage<ReportRow>> {
    const limit = Math.min(Math.max(Math.floor(options.limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
    // A report type is an event type such as `sales.order.created.v1`; the start of one (`sales`) selects the family.
    const conditions = [
      reportType
        ? ilike(reportRows.reportType, `${reportType.replace(/[\\%_]/g, (character) => `\\${character}`)}%`)
        : undefined,
      options.cursor
        ? sql`(${reportRows.occurredAt}, ${reportRows.id}) < (${options.cursor.sortAt}::timestamptz, ${options.cursor.id}::uuid)`
        : undefined,
    ].filter((condition): condition is SQL => condition !== undefined);
    const fetched = await this.database.db
      .select({
        ...getTableColumns(reportRows),
        sortAt: sql<string>`to_char(${reportRows.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(reportRows)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(reportRows.occurredAt), desc(reportRows.id))
      .limit(limit + 1);
    const visible = fetched.slice(0, limit);
    const last = visible.at(-1);
    return {
      rows: visible.map(({ sortAt: _sortAt, ...row }) => row),
      next: fetched.length > limit && last ? { sortAt: last.sortAt, id: last.id } : undefined,
    };
  }

  /**
   * Reads the other services as the caller would: `siteIds` is forwarded as the actor's site scope, so every
   * site-bound list answers only those sites and the totals never count another pharmacy's stock.
   */
  private async loadLiveOperations(catalogIdentity: CatalogIdentity, siteIds?: string[]): Promise<LiveOperations> {
    // Only the lists the dashboard sums in full are read here; every count comes from `loadCounts`, so no list is cut.
    const [sites, locations, suppliers, balances, batches] = await Promise.all([
      this.fetchRows(this.options.catalogUrl, "/sites", undefined, catalogIdentity),
      this.fetchRows(this.options.catalogUrl, "/storage-locations", siteIds, catalogIdentity),
      this.fetchRows(this.options.catalogUrl, "/suppliers", undefined, catalogIdentity),
      this.fetchRows(this.options.inventoryUrl, "/inventory/balances", siteIds),
      this.fetchRows(this.options.inventoryUrl, "/inventory/batches"),
    ]);
    return {
      sites: siteIds ? sites.filter((site) => siteIds.includes(String(site.id))) : sites,
      // The scope header is not the only line of defense: a service behind us could answer every location.
      locations: siteIds ? locations.filter((location) => siteIds.includes(String(location.siteId))) : locations,
      suppliers,
      balances,
      batches,
    };
  }

  /**
   * Counts the owning services answer with `COUNT(*)` over their whole table, so no page can cut them. An `undefined`
   * entry means a network-wide reader could not reach that service; the caller then uses the projection counter.
   */
  private async loadCounts(siteIds?: string[]): Promise<LiveCounts> {
    const [products, pendingTransfers, openPrescriptions, openStocktakes, pendingAdjustments, receipts] =
      await Promise.all([
        this.fetchCount(this.options.catalogUrl, "/products/count"),
        this.fetchCount(this.options.inventoryUrl, openTransferQuery, siteIds),
        this.fetchCount(this.options.salesUrl, openPrescriptionQuery, siteIds),
        this.fetchCount(this.options.inventoryUrl, openStocktakeQuery, siteIds),
        this.fetchCount(this.options.inventoryUrl, pendingAdjustmentQuery, siteIds),
        this.fetchCount(this.options.inventoryUrl, "/procurement/goods-receipts/count", siteIds),
      ]);
    return { products, pendingTransfers, openPrescriptions, openStocktakes, pendingAdjustments, receipts };
  }

  /** The rows of a list read. Anything that is not a list counts as no rows for an unscoped reader; see `readJson`. */
  /**
   * One strict read of an owning service: a missing URL, a non-2xx answer, or a body the schema refuses throws. An
   * analytics figure never silently leaves a service out.
   */
  private async readAnswer<Schema extends z.ZodType>(
    baseUrl: string | undefined,
    path: string,
    headers: Record<string, string>,
    schema: Schema,
  ): Promise<z.output<Schema>> {
    if (!baseUrl) throw new Error(`Analytics read of ${path} has no service URL configured`);
    const response = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(ANALYTICS_READ_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = asRecord(await response.json().catch(() => undefined));
      throw new AnalyticsReadError(path, response.status, typeof body.code === "string" ? body.code : undefined);
    }
    return schema.parse(await response.json());
  }

  /** The rows of a list read. Anything that is not a list counts as no rows for an unscoped reader; see `readJson`. */
  private async fetchRows(
    baseUrl: string | undefined,
    path: string,
    siteIds?: string[],
    identity?: CatalogIdentity,
  ): Promise<Array<Record<string, unknown>>> {
    const value = await this.readJson(baseUrl, path, siteIds, identity);
    if (!Array.isArray(value)) {
      if (siteIds) throw new Error(`Scoped read of ${path} did not answer a list`);
      return [];
    }
    return value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
  }

  private async fetchCount(baseUrl: string | undefined, path: string, siteIds?: string[]): Promise<number | undefined> {
    const count = asRecord(await this.readJson(baseUrl, path, siteIds)).count;
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) return count;
    if (siteIds) throw new Error(`Scoped read of ${path} did not answer a count`);
    return undefined;
  }

  /**
   * A site-bound read belongs to a scoped reader, and swallowing its failure would report a dashboard with no stock
   * or no takings as if that were the truth, so a scoped read throws and the route answers 5xx. The unscoped reader
   * keeps the lenient behavior: a network-wide dashboard is still useful without one read. `undefined` means that
   * unscoped read did not answer.
   */
  private async readJson(
    baseUrl: string | undefined,
    path: string,
    siteIds?: string[],
    identity?: CatalogIdentity,
  ): Promise<unknown> {
    if (!baseUrl) return undefined;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: identity
          ? { authorization: identity() }
          : {
              ...internalServiceHeaders(),
              ...(siteIds ? { [ACTOR_SITE_IDS_HEADER]: siteIds.join(",") } : {}),
            },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) {
        throw new Error(`${siteIds ? "Scoped read" : "Read"} of ${path} answered HTTP ${response.status}`);
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (siteIds) throw error;
      return undefined;
    }
  }
}

type LiveOperations = {
  sites: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  suppliers: Array<Record<string, unknown>>;
  balances: Array<Record<string, unknown>>;
  batches: Array<Record<string, unknown>>;
};

/** Each count is `undefined` when a network-wide reader could not reach its service. */
type LiveCounts = {
  products: number | undefined;
  pendingTransfers: number | undefined;
  openPrescriptions: number | undefined;
  openStocktakes: number | undefined;
  pendingAdjustments: number | undefined;
  receipts: number | undefined;
};

/** The open-state counts, as the owning services filter them. Their status values are the stored strings. */
const openTransferQuery = "/inventory/transfers/count?status=PendingApproval,Draft,Approved,InTransit";
const openPrescriptionQuery = "/prescriptions/count?excludeStatus=Dispensed,Cancelled";
const openStocktakeQuery = "/inventory/stocktakes/count?excludeStatus=Completed,Cancelled";
const pendingAdjustmentQuery = "/inventory/adjustments/count?status=Pending";

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
 * One valuation line per stocked balance row; an empty row has nothing to value and is left out. `basePrices` is the
 * catalog's `GET /pricing/base-prices` answer: one row per active product, its base-unit price today (null when no
 * published price qualifies). A product the catalog no longer lists has no price and no name.
 */
const valueBalances = (live: LiveOperations, basePrices: Array<Record<string, unknown>>): ValuationLine[] => {
  const prices = new Map(basePrices.map((row) => [String(row.productId), row]));
  const siteNames = new Map(live.sites.map((site) => [String(site.id), String(site.name)]));
  return live.balances
    .filter((row) => rowQuantity(row, "quantityOnHand") > 0)
    .map((row) => {
      const balance = asRecord(row.balance);
      const batch = asRecord(row.batch);
      const productId = typeof batch.productId === "string" ? batch.productId : null;
      const siteId = typeof balance.siteId === "string" ? balance.siteId : null;
      const price = productId === null ? undefined : prices.get(productId);
      const unitPrice = typeof price?.unitPrice === "number" ? price.unitPrice : null;
      const quantityOnHand = rowQuantity(row, "quantityOnHand");
      const quantityReserved = rowQuantity(row, "quantityReserved");
      return {
        productId,
        productName: (typeof price?.productName === "string" ? price.productName : undefined) ?? productId ?? "-",
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
