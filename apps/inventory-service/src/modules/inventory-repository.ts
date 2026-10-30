import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";

import type { InventoryDatabase } from "../shared/infrastructure/database.ts";
import { BusinessRuleError } from "../shared/business-rule-error.ts";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  goodsReceiptLines,
  idempotencyRecords,
  disposalLines,
  disposalRecords,
  inventoryBalances,
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
import { recordSiteAvailability, sellableBatch, today } from "./site-availability.ts";
import { expiryWindows, MAX_DISPENSE_COST_ROWS, type DispenseCostRow, type StockHealthRow } from "./stock-health.ts";
import type { ExpiringBatchRow } from "./action-plans/auto-plan-alerts.ts";
import type { TransferPosition } from "./transfer-suggestions.ts";
import { containsPattern, everything, type PageRequest } from "./page-cursor.ts";
import { afterCursor, dateSortValue, presentConditions, splitPage, timestampSortValue } from "./keyset-page.ts";

/** A dispense the stock cannot honour: the batch is wrong for the product, not releasable, or not on the shelf. */
export class StockDispenseError extends Error {}

export type StockDispenseLine = { productId: string; productBatchId: string; quantity: number };

export type DisposalReason = "Expired" | "Damaged" | "Recalled" | "Other";

export type DisposalLineInput = { productBatchId: string; storageLocationId: string; quantity: number };
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

/**
 * The site scope and the filters a status list and its count share, so a count always answers its list. A status
 * filter takes several values and an exclusion takes several too; an empty list means no filter.
 */
export type StatusListFilters = {
  siteIds?: string[] | undefined;
  statuses?: string[] | undefined;
  excludeStatuses?: string[] | undefined;
  /** Free text over the identifiers of the list; see the text matchers below for the columns of each list. */
  q?: string | undefined;
};

const statusConditions = (column: AnyPgColumn, filters: StatusListFilters): Array<SQL | undefined> => [
  filters.statuses?.length ? inArray(column, filters.statuses) : undefined,
  filters.excludeStatuses?.length ? notInArray(column, filters.excludeStatuses) : undefined,
];

const transferFilters = (filters: StatusListFilters): Array<SQL | undefined> => [
  filters.siteIds
    ? or(
        inArray(transferOrders.sourceSiteId, filters.siteIds),
        inArray(transferOrders.destinationSiteId, filters.siteIds),
      )
    : undefined,
  ...statusConditions(transferOrders.status, filters),
  filters.q ? ilike(transferOrders.transferNumber, containsPattern(filters.q)) : undefined,
];

const replenishmentFilters = (filters: ReplenishmentFilters): Array<SQL | undefined> => [
  filters.siteIds ? inArray(replenishmentRequests.siteId, filters.siteIds) : undefined,
  filters.requestedBy ? eq(replenishmentRequests.requestedBy, filters.requestedBy) : undefined,
  ...statusConditions(replenishmentRequests.status, filters),
  filters.q ? replenishmentText(filters.q) : undefined,
];

/** A pharmacist reads only the replenishment requests they made; `requestedBy` narrows the list to them. */
type ReplenishmentFilters = StatusListFilters & { requestedBy?: string | undefined };

const stocktakeFilters = (filters: StatusListFilters): Array<SQL | undefined> => [
  filters.siteIds ? inArray(stocktakes.siteId, filters.siteIds) : undefined,
  ...statusConditions(stocktakes.status, filters),
  filters.q ? stocktakeText(filters.q) : undefined,
];

const adjustmentFilters = (
  filters: StatusListFilters & { stocktakeSessionId?: string | undefined },
): Array<SQL | undefined> => [
  filters.siteIds ? inArray(stockAdjustments.siteId, filters.siteIds) : undefined,
  ...statusConditions(stockAdjustments.status, filters),
  filters.stocktakeSessionId ? eq(stockAdjustments.stocktakeSessionId, filters.stocktakeSessionId) : undefined,
  filters.q ? adjustmentText(filters.q) : undefined,
];

/** Adjustments carry no number: `q` matches their reason, their notes, or the number of the batch they move. */
const adjustmentText = (text: string): SQL | undefined => {
  const pattern = containsPattern(text);
  return or(
    ilike(stockAdjustments.reason, pattern),
    ilike(stockAdjustments.notes, pattern),
    sql`${stockAdjustments.productBatchId} in (select ${productBatches.id} from ${productBatches} where ${ilike(productBatches.batchNumber, pattern)})`,
  );
};

const disposalFilters = (filters: StatusListFilters): Array<SQL | undefined> => [
  filters.siteIds ? inArray(disposalRecords.siteId, filters.siteIds) : undefined,
  ...statusConditions(disposalRecords.status, filters),
  filters.q ? disposalText(filters.q) : undefined,
];

/** Disposals carry no number: `q` matches their reason, their note, or the number of a batch they name. */
const disposalText = (text: string): SQL | undefined => {
  const pattern = containsPattern(text);
  return or(
    ilike(disposalRecords.reason, pattern),
    ilike(disposalRecords.note, pattern),
    sql`exists (select 1 from ${disposalLines} inner join ${productBatches} on ${productBatches.id} = ${disposalLines.productBatchId} where ${disposalLines.disposalId} = ${disposalRecords.id} and ${ilike(productBatches.batchNumber, pattern)})`,
  );
};

/** Stocktakes carry no number: `q` matches their notes or the batch number of one of their lines. */
const stocktakeText = (text: string): SQL | undefined => {
  const pattern = containsPattern(text);
  return or(
    ilike(stocktakes.notes, pattern),
    sql`exists (select 1 from ${stocktakeLines} inner join ${productBatches} on ${productBatches.id} = ${stocktakeLines.productBatchId} where ${stocktakeLines.stocktakeId} = ${stocktakes.id} and ${ilike(productBatches.batchNumber, pattern)})`,
  );
};

/** Replenishment requests carry no number: `q` matches their notes or the batch number of one of their lines. */
const replenishmentText = (text: string): SQL | undefined => {
  const pattern = containsPattern(text);
  return or(
    ilike(replenishmentRequests.notes, pattern),
    sql`exists (select 1 from ${replenishmentRequestLines} inner join ${productBatches} on ${productBatches.id} = ${replenishmentRequestLines.productBatchId} where ${replenishmentRequestLines.replenishmentRequestId} = ${replenishmentRequests.id} and ${ilike(productBatches.batchNumber, pattern)})`,
  );
};

export class InventoryRepository {
  public constructor(private readonly database: InventoryDatabase) {}

  public async listBalances(
    filters: {
      productId?: string | undefined;
      siteIds?: string[] | undefined;
      storageLocationId?: string | undefined;
      includeZeroBalances?: boolean | undefined;
      /** Matches the batch number: a batch carries no SKU here, the catalog owns it. */
      q?: string | undefined;
    } = {},
    page: PageRequest = everything,
  ) {
    const conditions = presentConditions([
      filters.productId ? eq(productBatches.productId, filters.productId) : undefined,
      filters.siteIds ? inArray(inventoryBalances.siteId, filters.siteIds) : undefined,
      filters.storageLocationId ? eq(inventoryBalances.storageLocationId, filters.storageLocationId) : undefined,
      filters.includeZeroBalances === false ? gt(inventoryBalances.quantityOnHand, "0") : undefined,
      filters.q ? ilike(productBatches.batchNumber, containsPattern(filters.q)) : undefined,
      afterCursor({
        sortColumn: productBatches.expiryDate,
        idColumn: inventoryBalances.id,
        direction: "asc",
        kind: "date",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        balance: inventoryBalances,
        batch: productBatches,
        id: inventoryBalances.id,
        sortValue: dateSortValue(productBatches.expiryDate),
      })
      .from(inventoryBalances)
      .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(productBatches.expiryDate), asc(inventoryBalances.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    return { rows: items.map(({ balance, batch }) => ({ balance, batch })), nextCursor };
  }

  public async listBatches(
    filters: { productId?: string | undefined; q?: string | undefined; siteIds?: string[] | undefined } = {},
    page: PageRequest = everything,
  ) {
    const conditions = presentConditions([
      filters.productId ? eq(productBatches.productId, filters.productId) : undefined,
      filters.q ? ilike(productBatches.batchNumber, containsPattern(filters.q)) : undefined,
      // A batch is listed to a site-scoped reader only where it has a balance at one of their sites.
      filters.siteIds
        ? sql`exists (select 1 from ${inventoryBalances} where ${inventoryBalances.productBatchId} = ${productBatches.id} and ${inArray(inventoryBalances.siteId, filters.siteIds)})`
        : undefined,
      afterCursor({
        sortColumn: productBatches.expiryDate,
        idColumn: productBatches.id,
        direction: "asc",
        kind: "date",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({ batch: productBatches, id: productBatches.id, sortValue: dateSortValue(productBatches.expiryDate) })
      .from(productBatches)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(productBatches.expiryDate), asc(productBatches.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    return { rows: items.map(({ batch }) => batch), nextCursor };
  }

  public async getBatch(id: string) {
    return (await this.database.db.select().from(productBatches).where(eq(productBatches.id, id)).limit(1))[0];
  }

  /** The sites that hold stock of a batch, from its balances. */
  public async batchSiteIds(batchId: string): Promise<string[]> {
    const rows = await this.database.db
      .selectDistinct({ siteId: inventoryBalances.siteId })
      .from(inventoryBalances)
      .where(eq(inventoryBalances.productBatchId, batchId));
    return rows.map((row) => row.siteId);
  }

  public async listMovements(
    input: {
      productId?: string | undefined;
      productBatchId?: string | undefined;
      siteIds?: string[] | undefined;
      storageLocationId?: string | undefined;
      /** Inclusive bounds on when a movement occurred. */
      from?: Date | undefined;
      to?: Date | undefined;
    } = {},
    page: PageRequest = everything,
  ) {
    const conditions = presentConditions([
      input.productId ? eq(stockLedgerEntries.productId, input.productId) : undefined,
      input.productBatchId ? eq(stockLedgerEntries.productBatchId, input.productBatchId) : undefined,
      input.siteIds ? inArray(stockLedgerEntries.siteId, input.siteIds) : undefined,
      input.storageLocationId ? eq(stockLedgerEntries.storageLocationId, input.storageLocationId) : undefined,
      input.from ? gte(stockLedgerEntries.occurredAt, input.from) : undefined,
      input.to ? lte(stockLedgerEntries.occurredAt, input.to) : undefined,
      afterCursor({
        sortColumn: stockLedgerEntries.occurredAt,
        idColumn: stockLedgerEntries.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        entry: stockLedgerEntries,
        id: stockLedgerEntries.id,
        sortValue: timestampSortValue(stockLedgerEntries.occurredAt),
      })
      .from(stockLedgerEntries)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stockLedgerEntries.occurredAt), desc(stockLedgerEntries.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    return { rows: items.map(({ entry }) => entry), nextCursor };
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

  /**
   * What the goods handed over for sales cost, per sale (design 0007, gross profit). One row per order or prescription
   * with a `Dispense` entry at or after `since`. The unit cost of a batch is the mean of the costs recorded on its
   * receipt lines, weighted by the quantity received; a batch with no recorded cost is uncosted, so its quantity counts
   * in `quantity` but not in `costedQuantity`, and adds nothing to `cost`. At most `maxRows` rows are answered; one more
   * than that is read so the caller can tell the answer is cut.
   */
  public async dispenseCosts(input: { since: Date; maxRows?: number | undefined }): Promise<DispenseCostRow[]> {
    const maxRows = input.maxRows ?? MAX_DISPENSE_COST_ROWS;
    const dispensed = sql`${stockLedgerEntries.movementType} = 'Dispense'
      and ${stockLedgerEntries.occurredAt} >= ${input.since.toISOString()}::timestamptz
      and ${stockLedgerEntries.referenceType} in ('Order', 'Prescription')
      and ${stockLedgerEntries.referenceId} is not null`;
    const { rows } = await this.database.db.execute<{
      reference_type: "Order" | "Prescription";
      reference_id: string;
      quantity: string;
      costed_quantity: string;
      cost: string;
    }>(sql`
      with batch_costs as (
        select ${productBatches.id} as batch_id,
          sum(${goodsReceiptLines.unitCost} * ${goodsReceiptLines.quantity}) / sum(${goodsReceiptLines.quantity}) as unit_cost
        from ${productBatches}
        inner join ${goodsReceiptLines}
          on ${goodsReceiptLines.productId} = ${productBatches.productId}
          and ${goodsReceiptLines.batchNumber} = ${productBatches.batchNumber}
        where ${goodsReceiptLines.unitCost} is not null
          and ${goodsReceiptLines.quantity} > 0
          and ${productBatches.id} in (select ${stockLedgerEntries.productBatchId} from ${stockLedgerEntries} where ${dispensed})
        group by ${productBatches.id}
      )
      select ${stockLedgerEntries.referenceType} as reference_type,
        ${stockLedgerEntries.referenceId} as reference_id,
        sum(-${stockLedgerEntries.quantityDelta}) as quantity,
        coalesce(sum(-${stockLedgerEntries.quantityDelta}) filter (where batch_costs.unit_cost is not null), 0) as costed_quantity,
        coalesce(sum(-${stockLedgerEntries.quantityDelta} * batch_costs.unit_cost), 0) as cost
      from ${stockLedgerEntries}
      left join batch_costs on batch_costs.batch_id = ${stockLedgerEntries.productBatchId}
      where ${dispensed}
      group by ${stockLedgerEntries.referenceType}, ${stockLedgerEntries.referenceId}
      order by ${stockLedgerEntries.referenceId}
      limit ${maxRows + 1}
    `);
    return rows.map((row) => ({
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      quantity: Number(row.quantity),
      costedQuantity: Number(row.costed_quantity),
      cost: Math.round(Number(row.cost) * 100) / 100,
    }));
  }

  /**
   * Stock health per (site, product) that has a balance row or a ledger entry. The shelf figures (on hand, reserved,
   * expiry buckets) are as of `asOf`. The movement figures count the ledger in `[from, to)`, except `lastMovementAt`,
   * which is the latest movement of any time. One statement sums both sides, so no site or product is read row by row.
   */
  public async stockHealth(input: {
    from: Date;
    to: Date;
    siteIds?: string[] | undefined;
    asOf?: Date | undefined;
  }): Promise<StockHealthRow[]> {
    const windows = expiryWindows(input.asOf ?? new Date());
    const balanceScope = input.siteIds ? inArray(inventoryBalances.siteId, input.siteIds) : sql`true`;
    const ledgerScope = input.siteIds ? inArray(stockLedgerEntries.siteId, input.siteIds) : sql`true`;
    const inPeriod = sql`${stockLedgerEntries.occurredAt} >= ${input.from.toISOString()}::timestamptz and ${stockLedgerEntries.occurredAt} < ${input.to.toISOString()}::timestamptz`;
    const expiry = productBatches.expiryDate;
    // Balances never go negative (a movement that would take them below zero is refused), so counting the positive
    // rows of a bucket is counting the on-hand quantity of its batches.
    const onHandIn = (inBucket: SQL) =>
      sql`coalesce(sum(${inventoryBalances.quantityOnHand}) filter (where ${inventoryBalances.quantityOnHand} > 0 and ${inBucket}), 0)`;
    const { rows } = await this.database.db.execute<{
      site_id: string;
      product_id: string;
      on_hand: string;
      reserved: string;
      dispensed: string;
      net_change: string;
      last_movement_at: Date | string | null;
      expired: string;
      expiring30: string;
      expiring60: string;
      expiring90: string;
    }>(sql`
      with balance_totals as (
        select ${inventoryBalances.siteId} as site_id,
          ${productBatches.productId} as product_id,
          coalesce(sum(${inventoryBalances.quantityOnHand}), 0) as on_hand,
          coalesce(sum(${inventoryBalances.quantityReserved}), 0) as reserved,
          ${onHandIn(sql`${expiry} < ${windows.today}::date`)} as expired,
          ${onHandIn(sql`${expiry} >= ${windows.today}::date and ${expiry} <= ${windows.within30}::date`)} as "expiring30",
          ${onHandIn(sql`${expiry} > ${windows.within30}::date and ${expiry} <= ${windows.within60}::date`)} as "expiring60",
          ${onHandIn(sql`${expiry} > ${windows.within60}::date and ${expiry} <= ${windows.within90}::date`)} as "expiring90"
        from ${inventoryBalances}
        inner join ${productBatches} on ${productBatches.id} = ${inventoryBalances.productBatchId}
        where ${balanceScope}
        group by ${inventoryBalances.siteId}, ${productBatches.productId}
      ),
      ledger_totals as (
        select ${stockLedgerEntries.siteId} as site_id,
          ${stockLedgerEntries.productId} as product_id,
          coalesce(sum(${stockLedgerEntries.quantityDelta}) filter (where ${inPeriod}), 0) as net_change,
          coalesce(-sum(${stockLedgerEntries.quantityDelta}) filter (
            where ${stockLedgerEntries.movementType} = 'Dispense' and ${inPeriod}
          ), 0) as dispensed,
          max(${stockLedgerEntries.occurredAt}) as last_movement_at
        from ${stockLedgerEntries}
        where ${ledgerScope}
        group by ${stockLedgerEntries.siteId}, ${stockLedgerEntries.productId}
      )
      select keys.site_id, keys.product_id,
        coalesce(balance_totals.on_hand, 0) as on_hand,
        coalesce(balance_totals.reserved, 0) as reserved,
        coalesce(ledger_totals.dispensed, 0) as dispensed,
        coalesce(ledger_totals.net_change, 0) as net_change,
        ledger_totals.last_movement_at,
        coalesce(balance_totals.expired, 0) as expired,
        coalesce(balance_totals.expiring30, 0) as expiring30,
        coalesce(balance_totals.expiring60, 0) as expiring60,
        coalesce(balance_totals.expiring90, 0) as expiring90
      from (
        select site_id, product_id from balance_totals
        union
        select site_id, product_id from ledger_totals
      ) as keys
      left join balance_totals
        on balance_totals.site_id = keys.site_id and balance_totals.product_id = keys.product_id
      left join ledger_totals
        on ledger_totals.site_id = keys.site_id and ledger_totals.product_id = keys.product_id
      order by keys.site_id, keys.product_id
    `);
    return rows.map((row) => ({
      siteId: row.site_id,
      productId: row.product_id,
      onHand: Number(row.on_hand),
      reserved: Number(row.reserved),
      dispensed: Number(row.dispensed),
      netChange: Number(row.net_change),
      lastMovementAt: row.last_movement_at === null ? null : new Date(row.last_movement_at).toISOString(),
      expired: Number(row.expired),
      expiring30: Number(row.expiring30),
      expiring60: Number(row.expiring60),
      expiring90: Number(row.expiring90),
    }));
  }

  /**
   * The sellable stock and the dispensed quantity of every product at every site in scope (design 0007, transfer
   * suggestions). Only released, unexpired batches count, so a rejected or expired shelf is never offered to another
   * site; reserved stock is subtracted by the caller. A site that sold in the window but has no sellable stock left
   * still gets a row, with zero stock and no expiry.
   */
  public async transferPositions(input: {
    siteIds?: string[] | undefined;
    windowStart: Date;
    today: string;
  }): Promise<TransferPosition[]> {
    const balanceScope = input.siteIds ? inArray(inventoryBalances.siteId, input.siteIds) : sql`true`;
    const ledgerScope = input.siteIds ? inArray(stockLedgerEntries.siteId, input.siteIds) : sql`true`;
    const { rows } = await this.database.db.execute<{
      product_id: string;
      site_id: string;
      available: string;
      dispensed: string;
      earliest_expiry: string | null;
    }>(sql`
      with sellable as (
        select ${productBatches.productId} as product_id,
          ${inventoryBalances.siteId} as site_id,
          coalesce(sum(${inventoryBalances.quantityOnHand}), 0) as on_hand,
          coalesce(sum(${inventoryBalances.quantityReserved}), 0) as reserved,
          min(${productBatches.expiryDate})::text as earliest_expiry
        from ${inventoryBalances}
        inner join ${productBatches} on ${productBatches.id} = ${inventoryBalances.productBatchId}
        where ${productBatches.qualityStatus} = 'Released'
          and ${productBatches.expiryDate} >= ${input.today}::date
          and ${inventoryBalances.quantityOnHand} > 0
          and ${balanceScope}
        group by ${productBatches.productId}, ${inventoryBalances.siteId}
      ),
      dispensed as (
        select ${stockLedgerEntries.productId} as product_id,
          ${stockLedgerEntries.siteId} as site_id,
          coalesce(-sum(${stockLedgerEntries.quantityDelta}), 0) as dispensed
        from ${stockLedgerEntries}
        where ${stockLedgerEntries.movementType} = 'Dispense'
          and ${stockLedgerEntries.occurredAt} >= ${input.windowStart.toISOString()}::timestamptz
          and ${ledgerScope}
        group by ${stockLedgerEntries.productId}, ${stockLedgerEntries.siteId}
      )
      select keys.product_id, keys.site_id,
        coalesce(sellable.on_hand, 0) - coalesce(sellable.reserved, 0) as available,
        coalesce(dispensed.dispensed, 0) as dispensed,
        sellable.earliest_expiry
      from (
        select product_id, site_id from sellable
        union
        select product_id, site_id from dispensed
      ) as keys
      left join sellable
        on sellable.product_id = keys.product_id and sellable.site_id = keys.site_id
      left join dispensed
        on dispensed.product_id = keys.product_id and dispensed.site_id = keys.site_id
      order by keys.site_id, keys.product_id
    `);
    return rows.map((row) => ({
      productId: row.product_id,
      siteId: row.site_id,
      available: Number(row.available),
      dispensedQuantity: Number(row.dispensed),
      earliestExpiry: row.earliest_expiry,
    }));
  }

  /**
   * The on-hand stock of every batch that expires on or before `through` (YYYY-MM-DD), expired batches included, one
   * row per (site, batch) with the storage locations summed. A batch with nothing on hand is not an alert.
   */
  public async expiringBatches(through: string): Promise<ExpiringBatchRow[]> {
    const rows = await this.database.db
      .select({
        siteId: inventoryBalances.siteId,
        batchId: productBatches.id,
        productId: productBatches.productId,
        batchNumber: productBatches.batchNumber,
        expiryDate: productBatches.expiryDate,
        quantityOnHand: sql<string>`sum(${inventoryBalances.quantityOnHand})`,
      })
      .from(inventoryBalances)
      .innerJoin(productBatches, eq(productBatches.id, inventoryBalances.productBatchId))
      .where(and(sql`${inventoryBalances.quantityOnHand} > 0`, lte(productBatches.expiryDate, through)))
      .groupBy(inventoryBalances.siteId, productBatches.id)
      .orderBy(inventoryBalances.siteId, productBatches.id);
    return rows.map((row) => ({ ...row, quantityOnHand: Number(row.quantityOnHand) }));
  }

  public async listAdjustments(
    filters: StatusListFilters & { stocktakeSessionId?: string | undefined } = {},
    page: PageRequest = everything,
  ) {
    const conditions = presentConditions([
      ...adjustmentFilters(filters),
      afterCursor({
        sortColumn: stockAdjustments.createdAt,
        idColumn: stockAdjustments.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        adjustment: stockAdjustments,
        id: stockAdjustments.id,
        sortValue: timestampSortValue(stockAdjustments.createdAt),
      })
      .from(stockAdjustments)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    return { rows: items.map(({ adjustment }) => adjustment), nextCursor };
  }

  public async countAdjustments(filters: StatusListFilters & { stocktakeSessionId?: string | undefined } = {}) {
    const conditions = presentConditions(adjustmentFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockAdjustments)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
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

  public async getAdjustment(id: string) {
    return (await this.database.db.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).limit(1))[0];
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
        return rejected;
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
      await recordSiteAvailability(transaction, adjustment.productId, adjustment.siteId);
      const [approved] = await transaction
        .update(stockAdjustments)
        .set({ status: "Approved", approvedBy: actorId, approvalNotes: approvalNotes ?? null, updatedAt: new Date() })
        .where(eq(stockAdjustments.id, id))
        .returning();
      return approved;
    });
    return result;
  }

  public async createBatch(input: typeof productBatches.$inferInsert) {
    const [batch] = await this.database.db.insert(productBatches).values(input).returning();
    if (!batch) throw new Error("Batch insert did not return a row");
    return batch;
  }

  public async listDisposals(filters: StatusListFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...disposalFilters(filters),
      afterCursor({
        sortColumn: disposalRecords.createdAt,
        idColumn: disposalRecords.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        record: disposalRecords,
        id: disposalRecords.id,
        sortValue: timestampSortValue(disposalRecords.createdAt),
      })
      .from(disposalRecords)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(disposalRecords.createdAt), desc(disposalRecords.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const ids = items.map(({ record }) => record.id);
    const lines = ids.length
      ? await this.database.db
          .select({ line: disposalLines, batchNumber: productBatches.batchNumber })
          .from(disposalLines)
          .innerJoin(productBatches, eq(productBatches.id, disposalLines.productBatchId))
          .where(inArray(disposalLines.disposalId, ids))
          .orderBy(asc(productBatches.batchNumber))
      : [];
    return {
      rows: items.map(({ record }) => ({
        ...record,
        lines: lines
          .filter(({ line }) => line.disposalId === record.id)
          .map(({ line, batchNumber }) => ({ ...line, batchNumber })),
      })),
      nextCursor,
    };
  }

  public async getDisposal(id: string) {
    const [record] = await this.database.db.select().from(disposalRecords).where(eq(disposalRecords.id, id)).limit(1);
    if (!record) return undefined;
    const lines = await this.database.db
      .select({ line: disposalLines, batchNumber: productBatches.batchNumber })
      .from(disposalLines)
      .innerJoin(productBatches, eq(productBatches.id, disposalLines.productBatchId))
      .where(eq(disposalLines.disposalId, id))
      .orderBy(asc(productBatches.batchNumber));
    return { ...record, lines: lines.map(({ line, batchNumber }) => ({ ...line, batchNumber })) };
  }

  /**
   * Proposes a disposal. Stock does not move yet: the balances are checked so a proposal never names more than the
   * shelf holds, while the approval re-checks them because stock can leave in between.
   */
  public async createDisposal(input: {
    siteId: string;
    reason: DisposalReason;
    note?: string | null | undefined;
    lines: DisposalLineInput[];
    createdBy: string;
  }) {
    return this.database.db.transaction(async (transaction) => {
      const batchIds = [...new Set(input.lines.map((line) => line.productBatchId))];
      const batches = await transaction.select().from(productBatches).where(inArray(productBatches.id, batchIds));
      const batchById = new Map(batches.map((batch) => [batch.id, batch]));
      const validated: Array<{ line: DisposalLineInput; productId: string }> = [];
      for (const line of input.lines) {
        const batch = batchById.get(line.productBatchId);
        if (!batch)
          throw new BusinessRuleError(`Disposal line names a batch that does not exist: ${line.productBatchId}`);
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
        )[0];
        const available = balance === undefined ? 0 : Number(balance.quantityOnHand) - Number(balance.quantityReserved);
        if (line.quantity > available)
          throw new BusinessRuleError(
            `Disposal quantity ${line.quantity} exceeds the ${available} available of batch ${batch.batchNumber}`,
          );
        validated.push({ line, productId: batch.productId });
      }
      const [record] = await transaction
        .insert(disposalRecords)
        .values({
          siteId: input.siteId,
          reason: input.reason,
          note: input.note ?? null,
          createdBy: input.createdBy,
        })
        .returning();
      if (!record) throw new Error("Disposal insert did not return a row");
      const lines = await transaction
        .insert(disposalLines)
        .values(
          validated.map(({ line, productId }) => ({
            disposalId: record.id,
            productId,
            productBatchId: line.productBatchId,
            storageLocationId: line.storageLocationId,
            quantity: String(line.quantity),
          })),
        )
        .returning();
      return { ...record, lines };
    });
  }

  /**
   * A Pharmacy Manager decides a proposal. Approval moves each named batch off the shelf with a Disposal ledger entry;
   * rejection changes nothing. The whole decision is one transaction, so a stale quantity refuses the approval whole.
   */
  public async transitionDisposal(
    id: string,
    action: "approve" | "reject",
    actorId: string,
    decisionNotes?: string | null,
  ) {
    return this.database.db.transaction(async (transaction) => {
      const record = (
        await transaction.select().from(disposalRecords).where(eq(disposalRecords.id, id)).limit(1).for("update")
      )[0];
      if (!record) return undefined;
      if (record.status !== "PendingApproval")
        throw new BusinessRuleError(`Disposal record is already ${record.status}`);
      const decidedAt = new Date();
      if (action === "reject") {
        const [rejected] = await transaction
          .update(disposalRecords)
          .set({
            status: "Rejected",
            decidedBy: actorId,
            decisionNotes: decisionNotes ?? null,
            decidedAt,
            updatedAt: decidedAt,
          })
          .where(eq(disposalRecords.id, id))
          .returning();
        return rejected;
      }
      const lines = await transaction.select().from(disposalLines).where(eq(disposalLines.disposalId, id));
      if (lines.length === 0) throw new BusinessRuleError("Disposal record has no lines");
      for (const line of lines) {
        const balance = (
          await transaction
            .select()
            .from(inventoryBalances)
            .where(
              and(
                eq(inventoryBalances.productBatchId, line.productBatchId),
                eq(inventoryBalances.siteId, record.siteId),
                eq(inventoryBalances.storageLocationId, line.storageLocationId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        const previousOnHand = Number(balance?.quantityOnHand ?? 0);
        const quantity = Number(line.quantity);
        const previousReserved = Number(balance?.quantityReserved ?? 0);
        if (!balance || previousOnHand - previousReserved < quantity)
          throw new BusinessRuleError(`Disposal quantity exceeds the stock available for batch ${line.productBatchId}`);
        const nextOnHand = previousOnHand - quantity;
        const updated = await transaction
          .update(inventoryBalances)
          .set({
            quantityOnHand: String(nextOnHand),
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: decidedAt,
          })
          .where(and(eq(inventoryBalances.id, balance.id), eq(inventoryBalances.version, balance.version)))
          .returning();
        if (!updated[0]) throw new BusinessRuleError("Disposal stock was changed by another request");
        await transaction.insert(stockLedgerEntries).values({
          productId: line.productId,
          productBatchId: line.productBatchId,
          siteId: record.siteId,
          storageLocationId: line.storageLocationId,
          quantityDelta: String(-quantity),
          quantityAfter: String(nextOnHand),
          movementType: "Disposal",
          referenceType: "Disposal",
          referenceId: record.id,
          reason: record.reason,
          notes: record.note,
          createdBy: actorId,
        });
      }
      for (const productId of new Set(lines.map((line) => line.productId)))
        await recordSiteAvailability(transaction, productId, record.siteId);
      const [approved] = await transaction
        .update(disposalRecords)
        .set({
          status: "Approved",
          decidedBy: actorId,
          decisionNotes: decisionNotes ?? null,
          decidedAt,
          updatedAt: decidedAt,
        })
        .where(eq(disposalRecords.id, id))
        .returning();
      return approved;
    });
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
      for (const { siteId } of sites) await recordSiteAvailability(transaction, batch.productId, siteId);
      return batch;
    });
    return result;
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
      await recordSiteAvailability(transaction, input.productId, input.siteId);
      return { balance, ledger };
    });
    return result;
  }

  public async reserve(input: {
    reservationId: string;
    ownerId: string;
    siteId: string;
    /** One storage location, or every location of the site when left out. */
    storageLocationId?: string | undefined;
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
              input.storageLocationId ? eq(inventoryBalances.storageLocationId, input.storageLocationId) : undefined,
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
      for (const productId of new Set(input.lines.map((line) => line.productId)))
        await recordSiteAvailability(transaction, productId, input.siteId);
      return allocations;
    });
    return result;
  }

  /**
   * Gives back whatever a reservation still holds. A reservation line's quantity is what it still holds, so a
   * partly dispensed prescription releases only the rest, and a reservation that is no longer active is answered
   * as it is, which keeps a repeated cancel from releasing another sale's hold.
   */
  public async releaseReservation(id: string) {
    const reservation = await this.database.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.id, id))
        .for("update");
      if (!current || current.status !== "active") return current;
      const lines = await transaction
        .select()
        .from(stockReservationLines)
        .where(eq(stockReservationLines.reservationId, id));
      // A line carries no site, so the balance row that gave the hold back is what names the site to answer for.
      const answered = new Set<string>();
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
          await recordSiteAvailability(transaction, line.productId, siteId);
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
      return released;
    });
    return reservation;
  }

  /**
   * Hands the goods of a reservation over: each held quantity leaves the batch it was held on, with a `Dispense`
   * ledger entry that names the sale. A reservation that is not active is answered as it is, so a repeated call
   * never takes the stock twice, and an unknown reservation answers `undefined`.
   */
  public async consumeReservation(id: string, referenceType: string, referenceId: string, actorId?: string) {
    return this.database.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.id, id))
        .for("update");
      if (!current || current.status !== "active") return current;
      const lines = await transaction
        .select()
        .from(stockReservationLines)
        .where(and(eq(stockReservationLines.reservationId, id), gt(stockReservationLines.quantity, "0")))
        .for("update");
      const answered = new Set<string>();
      for (const line of lines) {
        const [balance] = await transaction
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.productBatchId, line.productBatchId),
              eq(inventoryBalances.storageLocationId, line.storageLocationId),
            ),
          )
          .for("update");
        const held = Number(line.quantity);
        if (!balance || Number(balance.quantityOnHand) < held)
          throw new StockDispenseError("A batch no longer holds the quantity that was reserved on it");
        const nextOnHand = Number(balance.quantityOnHand) - held;
        await transaction
          .update(inventoryBalances)
          .set({
            quantityOnHand: String(nextOnHand),
            quantityReserved: sql`GREATEST(${inventoryBalances.quantityReserved} - ${String(held)}, 0)`,
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, balance.id));
        await transaction.insert(stockLedgerEntries).values({
          productId: line.productId,
          productBatchId: line.productBatchId,
          siteId: balance.siteId,
          storageLocationId: line.storageLocationId,
          quantityDelta: String(-held),
          quantityAfter: String(nextOnHand),
          movementType: "Dispense",
          referenceType,
          referenceId,
          reason: `${referenceType} ${referenceId}`,
          createdBy: actorId ?? null,
        });
        answered.add(`${line.productId}:${balance.siteId}`);
      }
      await transaction
        .update(stockReservationLines)
        .set({ quantity: "0" })
        .where(eq(stockReservationLines.reservationId, id));
      const [consumed] = await transaction
        .update(stockReservations)
        .set({ status: "consumed", updatedAt: new Date() })
        .where(eq(stockReservations.id, id))
        .returning();
      for (const pair of answered) {
        const [productId, siteId] = pair.split(":") as [string, string];
        await recordSiteAvailability(transaction, productId, siteId);
      }
      return consumed;
    });
  }

  /**
   * Re-answers availability for stock that expired with nothing moving on the shelf. A balance on a released batch
   * that has crossed its expiry date drops out of what a site can sell, and only a sweep notices. The pairs are the
   * ones that had free stock on such a batch, because a batch nobody could buy never showed up as available;
   * `expiredOnOrAfter` gives the sweeper a lower bound so an expiry is not answered again on every run.
   */
  public async refreshAvailabilityForExpiredStock(expiredOnOrAfter?: string): Promise<number> {
    return this.database.db.transaction(async (transaction) => {
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
      for (const pair of pairs) await recordSiteAvailability(transaction, pair.productId, pair.siteId);
      return pairs.length;
    });
  }

  /**
   * Goods leave the shelf for a prescription. Each line comes off the batch the pharmacist handed over, which may
   * not be the batch FEFO reserved, so the reservation is released by product (the dispensed batch's hold first) and
   * the on-hand quantity drops on the dispensed batch. Every line writes a `Dispense` ledger entry, and once nothing
   * is held any more the reservation is consumed. A partial dispense keeps the rest of the hold for the next one.
   */
  public async dispense(input: StockDispense): Promise<StockDispenseResult> {
    const dispensedOn = today();
    const result = await this.database.db.transaction(async (transaction) => {
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
        return JSON.parse(existing?.response ?? "null") as StockDispenseResult;
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
            `Batch ${batch.batchNumber} has ${available} available at this location, ${line.quantity} needed`,
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
      for (const productId of touchedProducts) await recordSiteAvailability(transaction, productId, input.siteId);
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
      return result;
    });
    return result;
  }

  public async listReservations(ownerId?: string) {
    return this.database.db
      .select()
      .from(stockReservations)
      .where(ownerId ? eq(stockReservations.ownerId, ownerId) : undefined)
      .orderBy(asc(stockReservations.createdAt));
  }

  public async listTransfers(filters: StatusListFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...transferFilters(filters),
      afterCursor({
        sortColumn: transferOrders.createdAt,
        idColumn: transferOrders.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        transfer: transferOrders,
        id: transferOrders.id,
        sortValue: timestampSortValue(transferOrders.createdAt),
      })
      .from(transferOrders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(transferOrders.createdAt), desc(transferOrders.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ transfer }) => ({
        ...transfer,
        lines: await this.database.db
          .select()
          .from(transferOrderLines)
          .where(eq(transferOrderLines.transferOrderId, transfer.id)),
      })),
    );
    return { rows, nextCursor };
  }

  public async countTransfers(filters: StatusListFilters = {}) {
    const conditions = presentConditions(transferFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(transferOrders)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
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

  public async listReplenishments(filters: ReplenishmentFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...replenishmentFilters(filters),
      afterCursor({
        sortColumn: replenishmentRequests.createdAt,
        idColumn: replenishmentRequests.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        request: replenishmentRequests,
        id: replenishmentRequests.id,
        sortValue: timestampSortValue(replenishmentRequests.createdAt),
      })
      .from(replenishmentRequests)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(replenishmentRequests.createdAt), desc(replenishmentRequests.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ request }) => ({
        ...request,
        lines: await this.database.db
          .select()
          .from(replenishmentRequestLines)
          .where(eq(replenishmentRequestLines.replenishmentRequestId, request.id)),
      })),
    );
    return { rows, nextCursor };
  }

  public async countReplenishments(filters: ReplenishmentFilters = {}) {
    const conditions = presentConditions(replenishmentFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(replenishmentRequests)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
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
        return updated;
      }
      if (!current.storageLocationId) throw new Error("Fulfillment requires a storage location");
      const effectiveLines = await transaction
        .select()
        .from(replenishmentRequestLines)
        .where(eq(replenishmentRequestLines.replenishmentRequestId, id));
      if (effectiveLines.length === 0) throw new Error("Fulfillment requires replenishment lines");
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
        await recordSiteAvailability(transaction, line.productId, current.siteId);
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
      return updated;
    });
    return result;
  }

  public async listStocktakes(filters: StatusListFilters = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      ...stocktakeFilters(filters),
      afterCursor({
        sortColumn: stocktakes.createdAt,
        idColumn: stocktakes.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({ session: stocktakes, id: stocktakes.id, sortValue: timestampSortValue(stocktakes.createdAt) })
      .from(stocktakes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(stocktakes.createdAt), desc(stocktakes.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ session }) => ({
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
    return { rows, nextCursor };
  }

  public async countStocktakes(filters: StatusListFilters = {}) {
    const conditions = presentConditions(stocktakeFilters(filters));
    const [row] = await this.database.db
      .select({ count: sql<number>`count(*)::int` })
      .from(stocktakes)
      .where(conditions.length ? and(...conditions) : undefined);
    return Number(row?.count ?? 0);
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

  public async listReturns(filters: { siteIds?: string[] | undefined } = {}, page: PageRequest = everything) {
    const conditions = presentConditions([
      filters.siteIds ? inArray(returnRequests.siteId, filters.siteIds) : undefined,
      afterCursor({
        sortColumn: returnRequests.createdAt,
        idColumn: returnRequests.id,
        direction: "desc",
        kind: "timestamp",
        cursor: page.cursor,
      }),
    ]);
    const query = this.database.db
      .select({
        request: returnRequests,
        id: returnRequests.id,
        sortValue: timestampSortValue(returnRequests.createdAt),
      })
      .from(returnRequests)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(returnRequests.createdAt), desc(returnRequests.id));
    const fetched = page.limit === undefined ? await query : await query.limit(page.limit + 1);
    const { items, nextCursor } = splitPage(fetched, page.limit);
    const rows = await Promise.all(
      items.map(async ({ request }) => ({
        ...request,
        lines: await this.database.db.select().from(returnLines).where(eq(returnLines.returnRequestId, request.id)),
      })),
    );
    return { rows, nextCursor };
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
    /** The user acting; recorded as the approver when the action is an approval. */
    actorId: string | null,
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
          await recordSiteAvailability(transaction, line.productId, current.sourceSiteId);
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
          await recordSiteAvailability(transaction, line.productId, current.destinationSiteId);
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
          ...(action === "approve" ? { approvedBy: actorId, approvedAt: new Date() } : {}),
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
      return detailedTransfer;
    });
    return result;
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

  public async findStocktakeLine(id: string) {
    return (await this.database.db.select().from(stocktakeLines).where(eq(stocktakeLines.id, id)).limit(1))[0];
  }

  /**
   * Records a count on a line. The first count moves a Pending session to InProgress; a session that is Completed or
   * Cancelled takes no more counts.
   */
  public async countStocktakeLine(id: string, countedQuantity: number, countedBy: string | null) {
    return this.database.db.transaction(async (transaction) => {
      const line = (
        await transaction.select().from(stocktakeLines).where(eq(stocktakeLines.id, id)).limit(1).for("update")
      )[0];
      if (!line) return undefined;
      const session = (
        await transaction.select().from(stocktakes).where(eq(stocktakes.id, line.stocktakeId)).limit(1).for("update")
      )[0];
      if (!session) return undefined;
      if (["Completed", "Cancelled"].includes(session.status))
        throw new BusinessRuleError("Phiên kiểm kê đã hoàn tất hoặc đã hủy, không ghi nhận thêm số đếm.");
      if (session.status === "Pending")
        await transaction
          .update(stocktakes)
          .set({ status: "InProgress", updatedAt: new Date() })
          .where(eq(stocktakes.id, session.id));
      const [counted] = await transaction
        .update(stocktakeLines)
        .set({ countedQuantity: String(countedQuantity), status: "Counted", countedBy })
        .where(eq(stocktakeLines.id, id))
        .returning();
      return counted;
    });
  }

  public async postStocktake(id: string, actorId: string | null) {
    const result = await this.database.db.transaction(async (transaction) => {
      const session = (
        await transaction.select().from(stocktakes).where(eq(stocktakes.id, id)).limit(1).for("update")
      )[0];
      if (!session) return undefined;
      if (session.status !== "InProgress")
        throw new BusinessRuleError("Chỉ phiên kiểm kê đang kiểm mới được đăng điều chỉnh.");
      const lines = await transaction
        .select({ line: stocktakeLines, batch: productBatches })
        .from(stocktakeLines)
        .innerJoin(productBatches, eq(productBatches.id, stocktakeLines.productBatchId))
        .where(eq(stocktakeLines.stocktakeId, id));
      if (lines.length === 0 || lines.some(({ line }) => line.countedQuantity === null))
        throw new BusinessRuleError("Mọi dòng kiểm kê phải được đếm trước khi đăng điều chỉnh.");
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
            approvedBy: actorId,
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
          await recordSiteAvailability(transaction, batch.productId, session.siteId);
        }
        await transaction.update(stocktakeLines).set({ status: "Approved" }).where(eq(stocktakeLines.id, line.id));
      }
      const [updatedSession] = await transaction
        .update(stocktakes)
        .set({ status: "Completed", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(stocktakes.id, id))
        .returning();
      return updatedSession;
    });
    return result;
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
        await recordSiteAvailability(transaction, batch.productId, input.siteId);
      }
      return request;
    });
    return result;
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
