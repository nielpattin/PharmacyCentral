/**
 * The answer of `GET /api/dashboard/analytics` (design 0007, "Contracts"). Field names match the contract exactly.
 * A figure the server could not answer is `null`; the screen shows it as "—", never as 0.
 */

export type AnalyticsChannel = "all" | "counter" | "online";
export type SalesChannel = "counter" | "online";

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

export type AnalyticsResponse = {
  currency: string;
  generatedAt: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  siteId: string | null;
  channel: AnalyticsChannel;
  kpis: {
    revenue: FigurePair;
    orderCount: FigurePair;
    averageOrderValue: FigurePair;
    grossProfit: {
      current: Figure;
      previous: Figure;
      available: boolean;
      reason?: string | null;
      /** The share (0 to 1) of the period's revenue that belongs to sales whose goods all have a recorded cost. */
      coverage?: { current: Figure; previous: Figure };
    };
  };
  channels: Array<{ channel: SalesChannel; revenue: Figure; orderCount: Figure }>;
  breakdown: {
    goodsRevenue: Figure;
    bySite: SalesSiteRow[];
    topProducts: ProductRevenueRow[];
    abc: AbcRevenueRow[];
    byCategory: CategoryRevenueRow[];
    byPrescription: PrescriptionRevenueRow[];
  };
  inventory: {
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
};
