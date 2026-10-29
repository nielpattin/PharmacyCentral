import { z } from "zod";

/**
 * The period analytics of design 0007 (`GET /dashboard/analytics`): the input schemas of the internal reads, the query
 * validation, and every definition as a pure function. No I/O happens here; `operations-repository.ts` reads the owning
 * services and hands the answers to `buildDashboardAnalytics`.
 */

export const ANALYTICS_CHANNELS = ["all", "counter", "online"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];
export type SaleChannel = Exclude<AnalyticsChannel, "all">;

const DAY_MS = 86_400_000;
export const MAX_PERIOD_DAYS = 366;
export const DEAD_STOCK_DAYS = 90;
export const DEAD_STOCK_ITEM_LIMIT = 20;

const isoDateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

/** `GET /internal/analytics/sales-documents` of sales-service: `kind` `order` is online, `prescription` is counter. */
export const salesDocumentsAnswerSchema = z.object({
  documents: z.array(
    z.object({
      id: uuid,
      kind: z.enum(["order", "prescription"]),
      siteId: uuid.nullable(),
      createdAt: isoDateTime,
    }),
  ),
});

/** `GET /internal/analytics/paid-invoices` of payment-service: only `Paid` invoices, never refunded or pending ones. */
export const paidInvoicesAnswerSchema = z.object({
  invoices: z.array(
    z.object({
      orderId: uuid.nullable(),
      prescriptionId: uuid.nullable(),
      amount: z.number().nonnegative(),
      createdAt: isoDateTime,
    }),
  ),
});

/** `GET /internal/analytics/stock-health` of inventory-service: quantities in base units, one row per (site, product). */
export const stockHealthAnswerSchema = z.object({
  rows: z.array(
    z.object({
      siteId: uuid,
      productId: uuid,
      onHand: z.number(),
      reserved: z.number(),
      dispensed: z.number(),
      netChange: z.number(),
      lastMovementAt: isoDateTime.nullable(),
      expired: z.number().nonnegative(),
      expiring30: z.number().nonnegative(),
      expiring60: z.number().nonnegative(),
      expiring90: z.number().nonnegative(),
    }),
  ),
});

/**
 * `GET /internal/analytics/dispense-costs` of inventory-service: what the goods of each sale cost. `costedQuantity` is the
 * part of `quantity` taken from batches whose receipts recorded a cost; `cost` covers that part only.
 */
export const dispenseCostsAnswerSchema = z.object({
  rows: z.array(
    z.object({
      referenceType: z.enum(["Order", "Prescription"]),
      referenceId: uuid,
      quantity: z.number().nonnegative(),
      costedQuantity: z.number().nonnegative(),
      cost: z.number().nonnegative(),
    }),
  ),
});

/** `GET /pricing/base-prices` of catalog-service: one row per active product, `unitPrice` null when none qualifies. */
export const basePricesAnswerSchema = z.array(
  z.object({ productId: uuid, productName: z.string(), unitPrice: z.number().nullable() }),
);

/** `GET /sites` of catalog-service. */
export const sitesAnswerSchema = z.array(z.object({ id: uuid, name: z.string() }));

export type SalesDocument = z.output<typeof salesDocumentsAnswerSchema>["documents"][number];
export type PaidInvoice = z.output<typeof paidInvoicesAnswerSchema>["invoices"][number];
export type DispenseCost = z.output<typeof dispenseCostsAnswerSchema>["rows"][number];
export type StockHealthRow = z.output<typeof stockHealthAnswerSchema>["rows"][number];
export type BasePrice = z.output<typeof basePricesAnswerSchema>[number];
export type SiteName = z.output<typeof sitesAnswerSchema>[number];

/** The query of the route. `from` is inclusive, `to` exclusive; both are ISO date-times with an offset. */
export const analyticsQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
    siteId: uuid.optional(),
    channel: z.enum(ANALYTICS_CHANNELS).optional(),
  })
  .superRefine((query, context) => {
    const span = Date.parse(query.to) - Date.parse(query.from);
    if (!(span > 0)) {
      context.addIssue({ code: "custom", path: ["to"], message: "to must be after from" });
    } else if (span > MAX_PERIOD_DAYS * DAY_MS) {
      context.addIssue({ code: "custom", path: ["to"], message: "the period is longer than 366 days" });
    }
  });

export type Period = { from: Date; to: Date };

/** The period of the same length ending where `period` starts. */
export const previousPeriodOf = (period: Period): Period => ({
  from: new Date(period.from.getTime() - (period.to.getTime() - period.from.getTime())),
  to: period.from,
});

export type Sale = {
  documentId: string;
  channel: SaleChannel;
  siteId: string | null;
  createdAt: Date;
  revenue: number;
};

/**
 * A sale is a sales document (online order or counter prescription) that has at least one `Paid` invoice. Its revenue is
 * the sum of those invoice amounts. A document with only refunded or pending invoices is not a sale, because the read
 * carries `Paid` invoices alone.
 */
export const joinSales = (documents: SalesDocument[], invoices: PaidInvoice[]): Sale[] => {
  const paidByOrder = new Map<string, number>();
  const paidByPrescription = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.orderId !== null) {
      paidByOrder.set(invoice.orderId, (paidByOrder.get(invoice.orderId) ?? 0) + invoice.amount);
    }
    if (invoice.prescriptionId !== null) {
      paidByPrescription.set(
        invoice.prescriptionId,
        (paidByPrescription.get(invoice.prescriptionId) ?? 0) + invoice.amount,
      );
    }
  }
  const sales: Sale[] = [];
  for (const document of documents) {
    const isOrder = document.kind === "order";
    const revenue = (isOrder ? paidByOrder : paidByPrescription).get(document.id);
    if (revenue === undefined) continue;
    sales.push({
      documentId: document.id,
      channel: isOrder ? "online" : "counter",
      siteId: document.siteId,
      createdAt: new Date(document.createdAt),
      revenue,
    });
  }
  return sales;
};

/**
 * The sites a figure covers. `scope` is the caller's site scope (undefined means every site); `siteId` is the site the
 * caller asked for. A site-scoped reader never sees a row whose site is unknown.
 */
export type SiteFilter = { siteId: string | null; scope: readonly string[] | undefined };

export const siteVisible = (siteId: string | null, filter: SiteFilter): boolean => {
  if (filter.scope !== undefined && (siteId === null || !filter.scope.includes(siteId))) return false;
  return filter.siteId === null || siteId === filter.siteId;
};

export type SalesTotals = { revenue: number; orderCount: number };

/** Revenue and sale count of the sales bucketed by document `createdAt` in `period`, under the site and channel filters. */
export const totalSales = (
  sales: Sale[],
  period: Period,
  filter: SiteFilter,
  channel: AnalyticsChannel,
): SalesTotals => {
  const totals: SalesTotals = { revenue: 0, orderCount: 0 };
  for (const sale of sales) {
    // `to` is exclusive: a document created exactly at the boundary belongs to the next period.
    const createdAt = sale.createdAt.getTime();
    if (createdAt < period.from.getTime() || createdAt >= period.to.getTime()) continue;
    if (!siteVisible(sale.siteId, filter)) continue;
    if (channel !== "all" && channel !== sale.channel) continue;
    totals.revenue += sale.revenue;
    totals.orderCount += 1;
  }
  return totals;
};

/** Quantities from different batches are summed as decimals, so equality is judged to a millionth of a unit. */
const QUANTITY_TOLERANCE = 1e-6;

export type GrossProfit = {
  /** Revenue less the cost of goods of the sales whose cost is fully known; null when no sale in the period is. */
  current: number | null;
  /** Share of the period's revenue that belongs to those sales, 0 to 1; null when the period has no revenue. */
  coverage: number | null;
};

/**
 * A sale is costed when its goods are known and every unit taken from the shelf came from a batch with a recorded cost.
 * A sale that is partly costed or not at all adds neither its revenue nor a guessed cost: gross profit never covers it.
 */
export const costedSaleCost = (sale: Sale, costs: ReadonlyMap<string, DispenseCost>): number | null => {
  const row = costs.get(`${sale.channel === "online" ? "Order" : "Prescription"}:${sale.documentId}`);
  if (row === undefined || row.quantity <= 0) return null;
  return Math.abs(row.quantity - row.costedQuantity) <= QUANTITY_TOLERANCE ? row.cost : null;
};

export const indexDispenseCosts = (rows: DispenseCost[]): Map<string, DispenseCost> =>
  new Map(rows.map((row) => [`${row.referenceType}:${row.referenceId}`, row]));

/**
 * Gross profit of the sales bucketed by document `createdAt` in `period`, under the site and channel filters of
 * `totalSales`. A period with no sale has a true gross profit of 0 and no coverage; a period with sales but none costed
 * has none (null), which the page shows as "-" and never as 0.
 */
export const grossProfitOf = (
  sales: Sale[],
  costs: ReadonlyMap<string, DispenseCost>,
  period: Period,
  filter: SiteFilter,
  channel: AnalyticsChannel,
): GrossProfit => {
  let revenue = 0;
  let costedRevenue = 0;
  let costedCost = 0;
  let costedCount = 0;
  let saleCount = 0;
  for (const sale of sales) {
    const createdAt = sale.createdAt.getTime();
    if (createdAt < period.from.getTime() || createdAt >= period.to.getTime()) continue;
    if (!siteVisible(sale.siteId, filter)) continue;
    if (channel !== "all" && channel !== sale.channel) continue;
    saleCount += 1;
    revenue += sale.revenue;
    const cost = costedSaleCost(sale, costs);
    if (cost === null) continue;
    costedCount += 1;
    costedRevenue += sale.revenue;
    costedCost += cost;
  }
  if (saleCount === 0) return { current: 0, coverage: null };
  const coverage = revenue > 0 ? costedRevenue / revenue : null;
  return { current: costedCount === 0 ? null : Math.round(costedRevenue - costedCost), coverage };
};

/** Revenue per sale, whole dong; null when there is no sale to average. */
export const averageOrderValue = ({ revenue, orderCount }: SalesTotals): number | null =>
  orderCount === 0 ? null : Math.round(revenue / orderCount);

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** Units dispensed in the period over average stock: (opening + closing) / 2, opening = closing - net ledger change. */
export const turnoverOf = (rows: StockHealthRow[]): number | null => {
  const dispensed = sum(rows.map((row) => row.dispensed));
  const closing = sum(rows.map((row) => row.onHand));
  const opening = sum(rows.map((row) => row.onHand - row.netChange));
  const average = (opening + closing) / 2;
  return average > 0 ? dispensed / average : null;
};

/** Period days over turnover; null when turnover is null or 0, since stock then never turns over in the period. */
export const daysOfInventoryOf = (periodDays: number, turnover: number | null): number | null =>
  turnover === null || turnover <= 0 ? null : periodDays / turnover;

/**
 * The share of (site, product) pairs whose available quantity (on hand minus reserved) is 0 or less now. The denominator
 * is every pair that has a balance row or a ledger entry, which is what `stock-health` answers; null when there is none.
 */
export const stockoutRateOf = (rows: StockHealthRow[]): number | null => {
  if (rows.length === 0) return null;
  return rows.filter((row) => row.onHand - row.reserved <= 0).length / rows.length;
};

/** On-hand stock whose last ledger movement is older than the dead-stock threshold, or that has no movement at all. */
export const isDeadStock = (row: StockHealthRow, now: Date): boolean =>
  row.onHand > 0 &&
  (row.lastMovementAt === null || Date.parse(row.lastMovementAt) < now.getTime() - DEAD_STOCK_DAYS * DAY_MS);

/**
 * Quantity times the base-unit price, whole dong; null when the product has no published price, and then it adds nothing
 * to a total.
 */
export const lineValue = (quantity: number, unitPrice: number | null): number | null =>
  unitPrice === null ? null : Math.round(quantity * unitPrice);

export type DeadStockItem = {
  siteId: string;
  productId: string;
  productName: string;
  quantity: number;
  value: number | null;
};

type PriceLookup = (productId: string) => { productName: string; unitPrice: number | null };

/** A product the catalog no longer lists has no price and no name; its id stands in for the name. */
const priceLookup = (prices: BasePrice[]): PriceLookup => {
  const index = new Map(prices.map((row) => [row.productId, row]));
  return (productId) => {
    const price = index.get(productId);
    return { productName: price?.productName ?? productId, unitPrice: price?.unitPrice ?? null };
  };
};

/** Highest value first; a line with no price sorts last; ties by quantity, largest first. */
const byValueThenQuantity = (a: DeadStockItem, b: DeadStockItem): number => {
  if (a.value !== b.value) {
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value;
  }
  return b.quantity - a.quantity;
};

export type ExpiryBucket = { productCount: number; quantity: number; value: number };

export type StockValueSite = { siteId: string; siteName: string; quantity: number; value: number };

export type InventoryHealth = {
  turnover: number | null;
  daysOfInventory: number | null;
  stockoutRate: number | null;
  stockedProductCount: number;
  outOfStockProductCount: number;
  deadStock: {
    deadStockDays: number;
    productCount: number;
    quantity: number;
    value: number;
    items: DeadStockItem[];
  };
  stockValue: { total: number; missingPriceCount: number; bySite: StockValueSite[] };
  expiry: { expired: ExpiryBucket; within30: ExpiryBucket; within60: ExpiryBucket; within90: ExpiryBucket };
};

/** Product count, quantity and value of one expiry bucket; a line with no price adds nothing to the value. */
const expiryBucket = (
  rows: StockHealthRow[],
  quantityOf: (row: StockHealthRow) => number,
  lookup: PriceLookup,
): ExpiryBucket => {
  const held = rows.filter((row) => quantityOf(row) > 0);
  return {
    productCount: new Set(held.map((row) => row.productId)).size,
    quantity: sum(held.map(quantityOf)),
    value: sum(held.map((row) => lineValue(quantityOf(row), lookup(row.productId).unitPrice) ?? 0)),
  };
};

/**
 * Inventory health over the stock rows already filtered to the caller's sites. Stock is valued at today's base-unit
 * prices. `stockedProductCount` and `outOfStockProductCount` count (site, product) pairs, the units of the stockout rate.
 * The expiry rows are non-overlapping: `expiring30` is 0 to 30 days, `expiring60` 31 to 60 and `expiring90` 61 to 90.
 */
export const inventoryHealthOf = (
  rows: StockHealthRow[],
  input: { now: Date; periodDays: number; prices: BasePrice[]; sites: SiteName[] },
): InventoryHealth => {
  const lookup = priceLookup(input.prices);
  const siteNames = new Map(input.sites.map((site) => [site.id, site.name]));
  const stocked = rows.filter((row) => row.onHand > 0);

  const deadRows = stocked.filter((row) => isDeadStock(row, input.now));
  const deadItems: DeadStockItem[] = deadRows
    .map((row) => {
      const lookedUp = lookup(row.productId);
      return {
        siteId: row.siteId,
        productId: row.productId,
        productName: lookedUp.productName,
        quantity: row.onHand,
        value: lineValue(row.onHand, lookedUp.unitPrice),
      };
    })
    .sort(byValueThenQuantity);

  const bySite = [...new Set(stocked.map((row) => row.siteId))]
    .map((siteId) => {
      const siteRows = stocked.filter((row) => row.siteId === siteId);
      return {
        siteId,
        siteName: siteNames.get(siteId) ?? siteId,
        quantity: sum(siteRows.map((row) => row.onHand)),
        value: sum(siteRows.map((row) => lineValue(row.onHand, lookup(row.productId).unitPrice) ?? 0)),
      };
    })
    .sort((a, b) => a.siteName.localeCompare(b.siteName));

  const turnover = turnoverOf(rows);
  return {
    turnover,
    daysOfInventory: daysOfInventoryOf(input.periodDays, turnover),
    stockoutRate: stockoutRateOf(rows),
    stockedProductCount: rows.length,
    outOfStockProductCount: rows.filter((row) => row.onHand - row.reserved <= 0).length,
    deadStock: {
      deadStockDays: DEAD_STOCK_DAYS,
      productCount: new Set(deadRows.map((row) => row.productId)).size,
      quantity: sum(deadRows.map((row) => row.onHand)),
      value: sum(deadItems.map((item) => item.value ?? 0)),
      items: deadItems.slice(0, DEAD_STOCK_ITEM_LIMIT),
    },
    stockValue: {
      total: sum(bySite.map((site) => site.value)),
      missingPriceCount: stocked.filter((row) => lookup(row.productId).unitPrice === null).length,
      bySite,
    },
    expiry: {
      expired: expiryBucket(rows, (row) => row.expired, lookup),
      within30: expiryBucket(rows, (row) => row.expiring30, lookup),
      within60: expiryBucket(rows, (row) => row.expiring60, lookup),
      within90: expiryBucket(rows, (row) => row.expiring90, lookup),
    },
  };
};

export type AnalyticsInput = {
  now: Date;
  period: Period;
  siteId: string | null;
  scope: readonly string[] | undefined;
  channel: AnalyticsChannel;
  documents: SalesDocument[];
  invoices: PaidInvoice[];
  dispenseCosts: DispenseCost[];
  stockRows: StockHealthRow[];
  basePrices: BasePrice[];
  sites: SiteName[];
};

/**
 * The answer of `GET /dashboard/analytics`. The channel filter applies to the sales KPIs only; `channels` lists both
 * channels for the current period under the site filter, and inventory health ignores the channel because stock belongs
 * to a site. Gross profit covers the sales whose goods all have a purchase cost recorded on a goods receipt; see
 * `grossProfitOf`.
 */
export const buildDashboardAnalytics = (input: AnalyticsInput): DashboardAnalytics => {
  const filter: SiteFilter = { siteId: input.siteId, scope: input.scope };
  const previous = previousPeriodOf(input.period);
  const sales = joinSales(input.documents, input.invoices);
  const current = totalSales(sales, input.period, filter, input.channel);
  const prior = totalSales(sales, previous, filter, input.channel);
  const costs = indexDispenseCosts(input.dispenseCosts);
  const profit = grossProfitOf(sales, costs, input.period, filter, input.channel);
  const priorProfit = grossProfitOf(sales, costs, previous, filter, input.channel);
  const stockRows = input.stockRows.filter((row) => siteVisible(row.siteId, filter));
  const periodDays = (input.period.to.getTime() - input.period.from.getTime()) / DAY_MS;
  return {
    currency: "VND" as const,
    generatedAt: input.now.toISOString(),
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    previousPeriod: { from: previous.from.toISOString(), to: previous.to.toISOString() },
    siteId: input.siteId,
    channel: input.channel,
    kpis: {
      revenue: { current: current.revenue, previous: prior.revenue },
      orderCount: { current: current.orderCount, previous: prior.orderCount },
      averageOrderValue: { current: averageOrderValue(current), previous: averageOrderValue(prior) },
      grossProfit: {
        current: profit.current,
        previous: priorProfit.current,
        available: profit.current !== null,
        reason: profit.current === null ? ("no_cost_data" as const) : null,
        coverage: { current: profit.coverage, previous: priorProfit.coverage },
      },
    },
    channels: (["counter", "online"] as const).map((channel) => {
      const totals = totalSales(sales, input.period, filter, channel);
      return { channel, revenue: totals.revenue, orderCount: totals.orderCount };
    }),
    inventory: inventoryHealthOf(stockRows, {
      now: input.now,
      periodDays,
      prices: input.basePrices,
      sites: input.sites,
    }),
  };
};

export type DashboardAnalytics = {
  currency: "VND";
  generatedAt: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  siteId: string | null;
  channel: AnalyticsChannel;
  kpis: {
    revenue: { current: number; previous: number };
    orderCount: { current: number; previous: number };
    averageOrderValue: { current: number | null; previous: number | null };
    grossProfit: {
      current: number | null;
      previous: number | null;
      available: boolean;
      reason: "no_cost_data" | null;
      coverage: { current: number | null; previous: number | null };
    };
  };
  channels: Array<{ channel: SaleChannel; revenue: number; orderCount: number }>;
  inventory: InventoryHealth;
};
