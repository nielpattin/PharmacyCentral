import { z } from "zod";

/**
 * The period analytics of design 0007 (`GET /dashboard/analytics`): the input schemas of the internal reads, the query
 * validation, and every definition as a pure function. No I/O happens here; `operations-repository.ts` reads the owning
 * services of one tab and hands the answers to `buildAnalyticsSection`, so a request only computes the tab it asked for.
 */

export const ANALYTICS_CHANNELS = ["all", "counter", "online"] as const;
export type AnalyticsChannel = (typeof ANALYTICS_CHANNELS)[number];
export type SaleChannel = Exclude<AnalyticsChannel, "all">;

/**
 * The tabs of the page. Each one is its own answer: a request names the tab it wants, so the repository reads only the
 * services of that tab and the page never waits for a figure it is not showing.
 */
export const ANALYTICS_SECTIONS = ["overview", "revenue", "customers", "inventory"] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];

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
      customerId: uuid.nullable(),
      createdAt: isoDateTime,
    }),
  ),
});

/**
 * A line of a paid invoice: the product, the description taken at the sale, the quantity in the sold unit and its price.
 * A line that names no product is the delivery fee (or another charge), so it is revenue but not goods revenue.
 */
export const paidInvoiceLineSchema = z.object({
  productId: uuid.nullable(),
  description: z.string(),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
});

/** `GET /internal/analytics/paid-invoices` of payment-service: only `Paid` invoices, never refunded or pending ones. */
export const paidInvoicesAnswerSchema = z.object({
  invoices: z.array(
    z.object({
      orderId: uuid.nullable(),
      prescriptionId: uuid.nullable(),
      amount: z.number().nonnegative(),
      createdAt: isoDateTime,
      lines: z.array(paidInvoiceLineSchema),
    }),
  ),
});

/**
 * `GET /internal/analytics/customer-first-paid` of sales-service: one row per customer who bought in the period, with
 * the first payment ever seen for them. A date before the period makes the customer returning, a date inside it new.
 */
export const customerFirstPaidAnswerSchema = z.object({
  customers: z.array(z.object({ customerId: uuid, firstPaidAt: isoDateTime })),
});

/** The month of a sales target, `YYYY-MM`. */
export const salesTargetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** `GET /internal/analytics/sales-targets` of sales-service: one row per site with a target in the month. */
export const salesTargetsAnswerSchema = z.object({
  targets: z.array(
    z.object({ siteId: uuid, month: salesTargetMonthSchema, amount: z.number().nonnegative(), currency: z.string() }),
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

/**
 * `GET /internal/analytics/products` of catalog-service: every product, active or not, with the grouping the catalog
 * holds today. The grouping is not a snapshot of the sale, so a renamed category or a changed prescription flag moves
 * the history with it.
 */
export const productClassificationsAnswerSchema = z.object({
  products: z.array(
    z.object({
      productId: uuid,
      productName: z.string(),
      category: z.string().nullable(),
      prescriptionRequired: z.boolean(),
    }),
  ),
});

export type SalesDocument = z.output<typeof salesDocumentsAnswerSchema>["documents"][number];
export type PaidInvoice = z.output<typeof paidInvoicesAnswerSchema>["invoices"][number];
export type CustomerFirstPaid = z.output<typeof customerFirstPaidAnswerSchema>["customers"][number];
export type SalesTarget = z.output<typeof salesTargetsAnswerSchema>["targets"][number];
export type DispenseCost = z.output<typeof dispenseCostsAnswerSchema>["rows"][number];
export type StockHealthRow = z.output<typeof stockHealthAnswerSchema>["rows"][number];
export type BasePrice = z.output<typeof basePricesAnswerSchema>[number];
export type SiteName = z.output<typeof sitesAnswerSchema>[number];
export type SaleLine = z.output<typeof paidInvoiceLineSchema>;
export type ProductClassification = z.output<typeof productClassificationsAnswerSchema>["products"][number];

/** `from` is inclusive, `to` exclusive; both are ISO date-times with an offset. */
const periodQueryShape = {
  from: isoDateTime,
  to: isoDateTime,
  siteId: uuid.optional(),
  channel: z.enum(ANALYTICS_CHANNELS).optional(),
};

/** The refusal of a period that ends before it starts, or that is longer than the reads allow. */
const periodRefusal = (query: { from: string; to: string }): string | undefined => {
  const span = Date.parse(query.to) - Date.parse(query.from);
  if (!(span > 0)) return "to must be after from";
  if (span > MAX_PERIOD_DAYS * DAY_MS) return "the period is longer than 366 days";
  return undefined;
};

/** The query of `GET /dashboard/analytics`: the period and the tab whose figures are asked for. */
export const analyticsQuerySchema = z
  .object({ ...periodQueryShape, section: z.enum(ANALYTICS_SECTIONS) })
  .superRefine((query, context) => {
    const refusal = periodRefusal(query);
    if (refusal !== undefined) context.addIssue({ code: "custom", path: ["to"], message: refusal });
  });

/** The query of `GET /dashboard/sales-targets`: the period, and the month of the targets beside it. */
export const salesTargetQuerySchema = z
  .object({ ...periodQueryShape, month: salesTargetMonthSchema })
  .superRefine((query, context) => {
    const refusal = periodRefusal(query);
    if (refusal !== undefined) context.addIssue({ code: "custom", path: ["to"], message: refusal });
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
  /** The customer account on the document; null for a walk-in counter sale. */
  customerId: string | null;
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
      customerId: document.customerId,
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

/** How many products the top list carries. */
export const TOP_PRODUCT_LIMIT = 10;

/** One site's sales of the period. `siteName` is null only for a sale whose site is unknown. */
export type SalesSiteRow = {
  siteId: string | null;
  siteName: string | null;
  revenue: number;
  orderCount: number;
  averageOrderValue: number | null;
};

/** One product's goods revenue, and its share of the goods revenue of the period. */
export type ProductRevenueRow = {
  productId: string;
  productName: string;
  revenue: number;
  share: number | null;
};

/** The ABC cut-offs on cumulative goods revenue: A until 80%, B until 95%, C the rest. */
export const ABC_A_CUMULATIVE_SHARE = 0.8;
export const ABC_B_CUMULATIVE_SHARE = 0.95;
export const ABC_CLASSES = ["A", "B", "C"] as const;
export type AbcClass = (typeof ABC_CLASSES)[number];

export type AbcRevenueRow = {
  abcClass: AbcClass;
  productCount: number;
  revenue: number;
  share: number | null;
};

/**
 * The ABC classification of the period's products by goods revenue. Products are ranked highest revenue first; the
 * product that pushes the running share past a cut-off stays in the class it completes, so A covers at least 80% of
 * goods revenue. Products with no goods revenue are left out, and ties sort by product id so a class is stable.
 */
export const abcOf = (rows: readonly { productId: string; revenue: number }[]): AbcRevenueRow[] => {
  const ranked = rows
    .filter((row) => row.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue || left.productId.localeCompare(right.productId));
  const total = ranked.reduce((running, row) => running + row.revenue, 0);
  const classes = new Map<AbcClass, { productCount: number; revenue: number }>(
    ABC_CLASSES.map((abcClass) => [abcClass, { productCount: 0, revenue: 0 }]),
  );
  let running = 0;
  for (const row of ranked) {
    const before = total === 0 ? 1 : running / total;
    const abcClass: AbcClass = before < ABC_A_CUMULATIVE_SHARE ? "A" : before < ABC_B_CUMULATIVE_SHARE ? "B" : "C";
    const totals = classes.get(abcClass);
    if (totals === undefined) continue;
    totals.productCount += 1;
    totals.revenue += row.revenue;
    running += row.revenue;
  }
  return ABC_CLASSES.map((abcClass) => {
    const totals = classes.get(abcClass) ?? { productCount: 0, revenue: 0 };
    return {
      abcClass,
      productCount: totals.productCount,
      revenue: totals.revenue,
      share: total > 0 ? totals.revenue / total : null,
    };
  });
};

/** One catalog category of the period. `category` is null for a product the catalog gives no category. */
export type CategoryRevenueRow = {
  category: string | null;
  revenue: number;
  share: number | null;
};

/** The prescription split: a product that requires a prescription, one that does not, or one the catalog no longer lists. */
export type PrescriptionGroup = "prescription" | "otc" | "unknown";

export type PrescriptionRevenueRow = {
  group: PrescriptionGroup;
  revenue: number;
  share: number | null;
};

/**
 * The sales of the period broken down by site, product, catalog category and prescription flag. Figures come from the
 * invoice lines of the same sales the KPIs count, so the site rows add up to the revenue tile while the product tables
 * count goods alone: the delivery fee is revenue but belongs to no product.
 */
export type SalesBreakdown = {
  goodsRevenue: number;
  bySite: SalesSiteRow[];
  topProducts: ProductRevenueRow[];
  abc: AbcRevenueRow[];
  byCategory: CategoryRevenueRow[];
  byPrescription: PrescriptionRevenueRow[];
};

/**
 * The lines of each sale, gathered from every `Paid` invoice of its document. A document with two paid invoices has the
 * lines of both, the way `joinSales` sums their amounts.
 */
export const indexSaleLines = (invoices: PaidInvoice[]): Map<string, SaleLine[]> => {
  const linesByDocument = new Map<string, SaleLine[]>();
  for (const invoice of invoices) {
    const documentId = invoice.orderId ?? invoice.prescriptionId;
    if (documentId === null) continue;
    const lines = linesByDocument.get(documentId);
    if (lines === undefined) linesByDocument.set(documentId, [...invoice.lines]);
    else lines.push(...invoice.lines);
  }
  return linesByDocument;
};

/** Whether a sale belongs to the period, site filter and channel, the same bounds `totalSales` applies. */
const saleInScope = (sale: Sale, period: Period, filter: SiteFilter, channel: AnalyticsChannel): boolean => {
  const createdAt = sale.createdAt.getTime();
  if (createdAt < period.from.getTime() || createdAt >= period.to.getTime()) return false;
  if (!siteVisible(sale.siteId, filter)) return false;
  return channel === "all" || channel === sale.channel;
};

/**
 * The customers behind the period's sales. Only a sale whose document names a customer account counts as identified:
 * an online order always has one, a counter prescription only when the pharmacist linked the customer, and a walk-in
 * sale never does. A customer with one paid sale in the period is one-time; with two or more, repeat.
 */
export type CustomerInsights = {
  identifiedCustomerCount: number;
  oneTimeCustomerCount: number;
  repeatCustomerCount: number;
  identifiedRevenue: number;
  /** Share (0 to 1) of the period's sale revenue that comes from identified customers; null with no revenue. */
  identifiedShare: number | null;
  /** Paid sales of identified customers over those customers; null when none is identified. */
  purchasesPerCustomer: number | null;
  /** Identified customers whose first paid sale ever falls inside the period. */
  newCustomerCount: number;
  /** Identified customers with a paid sale before the period. */
  returningCustomerCount: number;
};

export const customerInsightsOf = (
  sales: readonly Sale[],
  period: Period,
  filter: SiteFilter,
  channel: AnalyticsChannel,
  firstPaidAt: ReadonlyMap<string, Date> = new Map(),
): CustomerInsights => {
  const purchases = new Map<string, number>();
  let revenue = 0;
  let identifiedRevenue = 0;
  let identifiedSales = 0;
  for (const sale of sales) {
    if (!saleInScope(sale, period, filter, channel)) continue;
    revenue += sale.revenue;
    if (sale.customerId === null) continue;
    identifiedRevenue += sale.revenue;
    identifiedSales += 1;
    purchases.set(sale.customerId, (purchases.get(sale.customerId) ?? 0) + 1);
  }
  let repeatCustomerCount = 0;
  for (const count of purchases.values()) {
    if (count > 1) repeatCustomerCount += 1;
  }
  const identifiedCustomerCount = purchases.size;
  let newCustomerCount = 0;
  for (const customerId of purchases.keys()) {
    const first = firstPaidAt.get(customerId);
    // A missing first-paid date means this period carries the first known payment, so the buyer counts as new.
    if (first === undefined || first >= period.from) newCustomerCount += 1;
  }
  return {
    identifiedCustomerCount,
    oneTimeCustomerCount: identifiedCustomerCount - repeatCustomerCount,
    repeatCustomerCount,
    identifiedRevenue,
    identifiedShare: revenue > 0 ? identifiedRevenue / revenue : null,
    purchasesPerCustomer: identifiedCustomerCount > 0 ? identifiedSales / identifiedCustomerCount : null,
    newCustomerCount,
    returningCustomerCount: identifiedCustomerCount - newCustomerCount,
  };
};

/** The revenue and paid-sale count of each named site in the period, under the site filter, all channels. */
export const siteRevenueOf = (
  sales: readonly Sale[],
  period: Period,
  filter: SiteFilter,
): Array<{ siteId: string; revenue: number; orderCount: number }> => {
  const rows = new Map<string, { revenue: number; orderCount: number }>();
  for (const sale of sales) {
    if (sale.siteId === null || !saleInScope(sale, period, filter, "all")) continue;
    const row = rows.get(sale.siteId) ?? { revenue: 0, orderCount: 0 };
    row.revenue += sale.revenue;
    row.orderCount += 1;
    rows.set(sale.siteId, row);
  }
  return [...rows].map(([siteId, row]) => ({ siteId, ...row }));
};

/** One site's month: its goal (null when none is set), the revenue it took, and the share of the goal reached. */
export type SalesTargetRow = {
  siteId: string;
  siteName: string;
  target: number | null;
  revenue: number;
  /** `revenue / target`; null without a target, never 0 for a missing one. */
  progress: number | null;
};

export type SalesTargetsReport = {
  month: string;
  currency: "VND";
  period: { from: string; to: string };
  sites: SalesTargetRow[];
  totals: { target: number; revenue: number; progress: number | null };
};

/**
 * The month's revenue against each site's target (BR-REPORT-018). Every site the caller may see is a row, whether or
 * not it has a target or a sale, so a manager can set the goal of a quiet site. Revenue counts the paid invoices of
 * the sales created in the month, whatever the channel; a sale with no site belongs to no site row. A target of a
 * site the catalog no longer lists is dropped. The totals add the rows; a revenue of 0 is answered, never "missing".
 */
export const buildSalesTargetsReport = (input: {
  month: string;
  period: Period;
  siteId: string | null;
  scope: readonly string[] | undefined;
  sites: readonly SiteName[];
  targets: readonly SalesTarget[];
  sales: readonly Sale[];
}): SalesTargetsReport => {
  const filter: SiteFilter = { siteId: input.siteId, scope: input.scope };
  const revenue = new Map(siteRevenueOf(input.sales, input.period, filter).map((row) => [row.siteId, row.revenue]));
  const targets = new Map(input.targets.map((target) => [target.siteId, target.amount]));
  const sites = input.sites
    .filter((site) => siteVisible(site.id, filter))
    .map((site) => {
      const target = targets.get(site.id) ?? null;
      const siteRevenue = revenue.get(site.id) ?? 0;
      return {
        siteId: site.id,
        siteName: site.name,
        target,
        revenue: siteRevenue,
        progress: target !== null && target > 0 ? siteRevenue / target : null,
      };
    })
    .sort((left, right) => left.siteName.localeCompare(right.siteName));
  const totalTarget = sites.reduce((sum, row) => sum + (row.target ?? 0), 0);
  const totalRevenue = sites.reduce((sum, row) => sum + row.revenue, 0);
  return {
    month: input.month,
    currency: "VND",
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    sites,
    totals: {
      target: totalTarget,
      revenue: totalRevenue,
      progress: totalTarget > 0 ? totalRevenue / totalTarget : null,
    },
  };
};

/** The revenue of one invoice line, in whole dong. */
const lineRevenue = (line: SaleLine): number => Math.round(line.quantity * line.unitPrice);

/** Highest revenue first; ties by label, so a list is stable from one request to the next. */
const byRevenueThenLabel = <Row extends { revenue: number }>(
  labelOf: (row: Row) => string,
): ((a: Row, b: Row) => number) => {
  return (a, b) => b.revenue - a.revenue || labelOf(a).localeCompare(labelOf(b));
};

/**
 * The site, product, category and prescription breakdown of the sales in `period`, under the site and channel filters.
 * A product takes its name and grouping from the catalog; a product the catalog no longer lists keeps the description
 * of its invoice line and counts as `unknown` in the prescription split.
 */
export const salesBreakdownOf = (input: {
  sales: readonly Sale[];
  linesByDocument: ReadonlyMap<string, readonly SaleLine[]>;
  products: readonly ProductClassification[];
  sites: readonly SiteName[];
  period: Period;
  filter: SiteFilter;
  channel: AnalyticsChannel;
}): SalesBreakdown => {
  const products = new Map(input.products.map((product) => [product.productId, product]));
  const siteNames = new Map(input.sites.map((site) => [site.id, site.name]));
  const bySite = new Map<string | null, { revenue: number; orderCount: number }>();
  const byProduct = new Map<string, { revenue: number; description: string | null }>();
  const byCategory = new Map<string, { category: string | null; revenue: number }>();
  const byPrescription: Record<PrescriptionGroup, number> = { prescription: 0, otc: 0, unknown: 0 };
  let goodsRevenue = 0;

  for (const sale of input.sales) {
    if (!saleInScope(sale, input.period, input.filter, input.channel)) continue;
    const site = bySite.get(sale.siteId) ?? { revenue: 0, orderCount: 0 };
    site.revenue += sale.revenue;
    site.orderCount += 1;
    bySite.set(sale.siteId, site);

    for (const line of input.linesByDocument.get(sale.documentId) ?? []) {
      // A line with no product is the delivery fee or another charge: revenue, but not goods revenue.
      if (line.productId === null) continue;
      const revenue = lineRevenue(line);
      goodsRevenue += revenue;

      const product = byProduct.get(line.productId) ?? { revenue: 0, description: null };
      product.revenue += revenue;
      if (line.description.length > 0) product.description = line.description;
      byProduct.set(line.productId, product);

      const classification = products.get(line.productId);
      const category = classification?.category?.trim() || null;
      // Categories are free text, so two spellings of one category count together; the first one seen is shown.
      const categoryKey = category === null ? "" : category.toLowerCase();
      const group = byCategory.get(categoryKey) ?? { category, revenue: 0 };
      group.revenue += revenue;
      byCategory.set(categoryKey, group);

      const prescriptionGroup: PrescriptionGroup =
        classification === undefined ? "unknown" : classification.prescriptionRequired ? "prescription" : "otc";
      byPrescription[prescriptionGroup] += revenue;
    }
  }

  const share = (revenue: number): number | null => (goodsRevenue > 0 ? revenue / goodsRevenue : null);

  const siteRows: SalesSiteRow[] = [...bySite.entries()]
    .map(([siteId, totals]) => ({
      siteId,
      siteName: siteId === null ? null : (siteNames.get(siteId) ?? siteId),
      revenue: totals.revenue,
      orderCount: totals.orderCount,
      averageOrderValue: totals.orderCount === 0 ? null : Math.round(totals.revenue / totals.orderCount),
    }))
    .sort(byRevenueThenLabel((row) => row.siteName ?? ""));

  const productRows = [...byProduct.entries()].map(([productId, row]) => ({
    productId,
    productName: products.get(productId)?.productName ?? row.description ?? productId.slice(0, 8),
    revenue: row.revenue,
  }));
  const topProducts: ProductRevenueRow[] = productRows
    .map((row) => ({ ...row, share: share(row.revenue) }))
    .sort(byRevenueThenLabel((row) => row.productName))
    .slice(0, TOP_PRODUCT_LIMIT);

  const categoryRows: CategoryRevenueRow[] = [...byCategory.values()]
    .map((row) => ({ category: row.category, revenue: row.revenue, share: share(row.revenue) }))
    .sort(byRevenueThenLabel((row) => row.category ?? ""));

  const prescriptionRows: PrescriptionRevenueRow[] = (["prescription", "otc"] as const).map((group) => ({
    group,
    revenue: byPrescription[group],
    share: share(byPrescription[group]),
  }));
  if (byPrescription.unknown > 0) {
    prescriptionRows.push({ group: "unknown", revenue: byPrescription.unknown, share: share(byPrescription.unknown) });
  }

  return {
    goodsRevenue,
    bySite: siteRows,
    topProducts,
    abc: abcOf(productRows),
    byCategory: categoryRows,
    byPrescription: prescriptionRows,
  };
};

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

/** What every tab's answer carries: the period it covers, the period before it, and the filter it answered for. */
export type AnalyticsEnvelope = {
  section: AnalyticsSection;
  currency: "VND";
  generatedAt: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  siteId: string | null;
  channel: AnalyticsChannel;
};

/** The tiles of the overview, each with the same figure of the previous period beside it. */
export type AnalyticsKpis = {
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

/** One channel of the period under the site filter; the requested channel does not narrow this row. */
export type ChannelTotal = { channel: SaleChannel; revenue: number; orderCount: number };

/**
 * The overview tab: the sales tiles, the gross profit beside them, and both channels of the period. The channel filter
 * applies to the tiles only, as it always has.
 */
export type OverviewAnalytics = AnalyticsEnvelope & {
  section: "overview";
  kpis: AnalyticsKpis;
  channels: ChannelTotal[];
};

/** The revenue tab: the site, product, category and prescription breakdown of the period's sales. */
export type RevenueAnalytics = AnalyticsEnvelope & { section: "revenue"; breakdown: SalesBreakdown };

/** The customers tab: who bought in the period, and how many of them are new. */
export type CustomersAnalytics = AnalyticsEnvelope & { section: "customers"; customers: CustomerInsights };

/** The inventory tab: stock health of the caller's sites. The channel does not apply, because stock belongs to a site. */
export type InventoryAnalytics = AnalyticsEnvelope & { section: "inventory"; inventory: InventoryHealth };

/**
 * The answer of `GET /dashboard/analytics`, one member per `ANALYTICS_SECTIONS` entry. A request answers exactly one
 * member, so a caller never receives figures of a tab it did not ask for.
 */
export type DashboardAnalytics = OverviewAnalytics | RevenueAnalytics | CustomersAnalytics | InventoryAnalytics;

type SectionQuery = {
  now: Date;
  period: Period;
  siteId: string | null;
  scope: readonly string[] | undefined;
  channel: AnalyticsChannel;
};

/** Overview reads the sales of both periods, their paid invoices, and what the goods of those sales cost. */
export type OverviewInput = SectionQuery & {
  section: "overview";
  documents: SalesDocument[];
  invoices: PaidInvoice[];
  dispenseCosts: DispenseCost[];
};

/** Revenue reads the period's sales with their invoice lines, and the catalog names and grouping of the products. */
export type RevenueInput = SectionQuery & {
  section: "revenue";
  documents: SalesDocument[];
  invoices: PaidInvoice[];
  products: ProductClassification[];
  sites: SiteName[];
};

/** Customers reads the period's sales and the first payment ever seen for each of their customers. */
export type CustomersInput = SectionQuery & {
  section: "customers";
  documents: SalesDocument[];
  invoices: PaidInvoice[];
  customerFirstPaid: CustomerFirstPaid[];
};

/** Inventory reads the stock of the period and today's base prices; it takes no sales read at all. */
export type InventoryInput = SectionQuery & {
  section: "inventory";
  stockRows: StockHealthRow[];
  basePrices: BasePrice[];
  sites: SiteName[];
};

export type AnalyticsSectionInput = OverviewInput | RevenueInput | CustomersInput | InventoryInput;

const envelopeOf = (input: AnalyticsSectionInput): AnalyticsEnvelope => {
  const previous = previousPeriodOf(input.period);
  return {
    section: input.section,
    currency: "VND" as const,
    generatedAt: input.now.toISOString(),
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    previousPeriod: { from: previous.from.toISOString(), to: previous.to.toISOString() },
    siteId: input.siteId,
    channel: input.channel,
  };
};

/**
 * The tiles of the overview: the period's sales beside those of the previous one. Gross profit covers the sales whose
 * goods all have a purchase cost recorded on a goods receipt; see `grossProfitOf`.
 */
const kpisOf = (input: OverviewInput, sales: Sale[], filter: SiteFilter): AnalyticsKpis => {
  const previous = previousPeriodOf(input.period);
  const current = totalSales(sales, input.period, filter, input.channel);
  const prior = totalSales(sales, previous, filter, input.channel);
  const costs = indexDispenseCosts(input.dispenseCosts);
  const profit = grossProfitOf(sales, costs, input.period, filter, input.channel);
  const priorProfit = grossProfitOf(sales, costs, previous, filter, input.channel);
  return {
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
  };
};

/**
 * One tab of the page, computed from the reads of that tab alone. The overview answers `kpis` and `channels`, revenue
 * answers `breakdown`, customers answers `customers` and inventory answers `inventory`; nothing else is computed, so a
 * tab never pays for the figures of another.
 */
export function buildAnalyticsSection(input: OverviewInput): OverviewAnalytics;
export function buildAnalyticsSection(input: RevenueInput): RevenueAnalytics;
export function buildAnalyticsSection(input: CustomersInput): CustomersAnalytics;
export function buildAnalyticsSection(input: InventoryInput): InventoryAnalytics;
export function buildAnalyticsSection(input: AnalyticsSectionInput): DashboardAnalytics {
  const envelope = envelopeOf(input);
  const filter: SiteFilter = { siteId: input.siteId, scope: input.scope };
  switch (input.section) {
    case "overview": {
      const sales = joinSales(input.documents, input.invoices);
      // Both channels of the current period under the site filter; the requested channel narrows the tiles, not this row.
      return {
        ...envelope,
        section: "overview",
        kpis: kpisOf(input, sales, filter),
        channels: (["counter", "online"] as const).map((channel) => {
          const totals = totalSales(sales, input.period, filter, channel);
          return { channel, revenue: totals.revenue, orderCount: totals.orderCount };
        }),
      };
    }
    case "revenue":
      return {
        ...envelope,
        section: "revenue",
        breakdown: salesBreakdownOf({
          sales: joinSales(input.documents, input.invoices),
          linesByDocument: indexSaleLines(input.invoices),
          products: input.products,
          sites: input.sites,
          period: input.period,
          filter,
          channel: input.channel,
        }),
      };
    case "customers":
      return {
        ...envelope,
        section: "customers",
        customers: customerInsightsOf(
          joinSales(input.documents, input.invoices),
          input.period,
          filter,
          input.channel,
          new Map(input.customerFirstPaid.map((row) => [row.customerId, new Date(row.firstPaidAt)])),
        ),
      };
    case "inventory":
      return {
        ...envelope,
        section: "inventory",
        // Stock of a site the caller may not see never enters the figures.
        inventory: inventoryHealthOf(
          input.stockRows.filter((row) => siteVisible(row.siteId, filter)),
          {
            now: input.now,
            periodDays: (input.period.to.getTime() - input.period.from.getTime()) / DAY_MS,
            prices: input.basePrices,
            sites: input.sites,
          },
        ),
      };
  }
}
