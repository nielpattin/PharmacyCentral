/**
 * The answers of `GET /api/dashboard/analytics` (design 0007, "Contracts"). Field names match the contract exactly.
 * A figure the server could not answer is `null`; the screen shows it as "—", never as 0.
 *
 * One request answers one `section`, so the response is a union discriminated on `section`: the common envelope plus
 * exactly the block that section owns. The page reads only the block its tab asks for; a field another section owns is
 * absent, not empty.
 */

export type AnalyticsChannel = "all" | "counter" | "online";
export type SalesChannel = "counter" | "online";

/** The section a response answers: one request per tab of the Analytics page. */
export type AnalyticsSection = "overview" | "revenue" | "customers" | "inventory";

/** A figure the server answered, or null when it could not be answered. */
export type Figure = number | null;

export type FigurePair = { current: Figure; previous: Figure };

export type ExpiryBucket = { productCount: Figure; quantity: Figure; value: Figure };

export type DeadStockItem = {
  siteId: string;
  productId: string;
  productName: string;
  quantity: Figure;
  value: Figure;
};

export type SalesSiteRow = {
  siteId: string | null;
  siteName: string | null;
  revenue: Figure;
  orderCount: Figure;
  averageOrderValue: Figure;
};

export type ProductRevenueRow = {
  productId: string;
  productName: string;
  revenue: Figure;
  /** The share (0 to 1) of goods revenue; null when the period sold no goods. */
  share: Figure;
};

export type AbcClass = "A" | "B" | "C";

export type AbcRevenueRow = {
  abcClass: AbcClass;
  productCount: Figure;
  revenue: Figure;
  /** The share (0 to 1) of goods revenue; null when the period sold no goods. */
  share: Figure;
};

export type CategoryRevenueRow = {
  /** The catalog category, or null for a product with none. */
  category: string | null;
  revenue: Figure;
  share: Figure;
};

export type PrescriptionGroup = "prescription" | "otc" | "unknown";

export type PrescriptionRevenueRow = {
  group: PrescriptionGroup;
  revenue: Figure;
  share: Figure;
};

export type CustomerInsights = {
  identifiedCustomerCount: Figure;
  oneTimeCustomerCount: Figure;
  repeatCustomerCount: Figure;
  identifiedRevenue: Figure;
  /** The share (0 to 1) of sale revenue from identified customers; null when the period has no revenue. */
  identifiedShare: Figure;
  /** Paid sales of identified customers over those customers; null when none is identified. */
  purchasesPerCustomer: Figure;
  /** Identified customers whose first paid sale ever is inside the period. */
  newCustomerCount: Figure;
  /** Identified customers with a paid sale before the period. */
  returningCustomerCount: Figure;
};

export type GrossProfit = {
  current: Figure;
  previous: Figure;
  available: boolean;
  reason?: string | null;
  /** The share (0 to 1) of the period's revenue that belongs to sales whose goods all have a recorded cost. */
  coverage?: { current: Figure; previous: Figure };
};

export type AnalyticsKpis = {
  revenue: FigurePair;
  orderCount: FigurePair;
  averageOrderValue: FigurePair;
  grossProfit: GrossProfit;
};

export type ChannelTotal = { channel: SalesChannel; revenue: Figure; orderCount: Figure };

export type RevenueBreakdown = {
  goodsRevenue: Figure;
  bySite: SalesSiteRow[];
  topProducts: ProductRevenueRow[];
  abc: AbcRevenueRow[];
  byCategory: CategoryRevenueRow[];
  byPrescription: PrescriptionRevenueRow[];
};

export type InventoryHealth = {
  turnover: Figure;
  daysOfInventory: Figure;
  stockoutRate: Figure;
  stockedProductCount: Figure;
  outOfStockProductCount: Figure;
  deadStock: {
    deadStockDays: number;
    productCount: Figure;
    quantity: Figure;
    value: Figure;
    items: DeadStockItem[];
  };
  stockValue: {
    total: Figure;
    missingPriceCount: Figure;
    bySite: Array<{ siteId: string; siteName: string; quantity: Figure; value: Figure }>;
  };
  expiry: {
    expired: ExpiryBucket;
    within30: ExpiryBucket;
    within60: ExpiryBucket;
    within90: ExpiryBucket;
  };
};

/** What every section answers: the currency, when it was computed, the periods it covers and the filters it applied. */
export type AnalyticsEnvelope = {
  currency: string;
  generatedAt: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  siteId: string | null;
  channel: AnalyticsChannel;
};

export type AnalyticsOverviewResponse = AnalyticsEnvelope & {
  section: "overview";
  kpis: AnalyticsKpis;
  channels: ChannelTotal[];
};

export type AnalyticsRevenueResponse = AnalyticsEnvelope & {
  section: "revenue";
  breakdown: RevenueBreakdown;
};

export type AnalyticsCustomersResponse = AnalyticsEnvelope & {
  section: "customers";
  customers: CustomerInsights;
};

export type AnalyticsInventoryResponse = AnalyticsEnvelope & {
  section: "inventory";
  inventory: InventoryHealth;
};

/** One request answers one section; the tab that is open reads its own arm of the union. */
export type AnalyticsResponse =
  | AnalyticsOverviewResponse
  | AnalyticsRevenueResponse
  | AnalyticsCustomersResponse
  | AnalyticsInventoryResponse;

/** One site's row of the month's revenue-against-target report. */
export type SalesTargetSiteRow = {
  siteId: string;
  siteName: string;
  /** The month's goal; null when the site has none. */
  target: Figure;
  revenue: Figure;
  /** `revenue / target`; null without a target. */
  progress: Figure;
};

export type SalesTargetsResponse = {
  month: string;
  currency: string;
  period: { from: string; to: string };
  sites: SalesTargetSiteRow[];
  totals: { target: Figure; revenue: Figure; progress: Figure };
};
