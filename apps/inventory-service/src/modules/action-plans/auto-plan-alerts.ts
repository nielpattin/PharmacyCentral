import type { ActionPlanSourceType } from "../../contracts/action-plans.ts";
import type { ReplenishmentSuggestion } from "../replenishment-suggestions.ts";
import { DEAD_STOCK_DAYS, type StockHealthRow } from "../stock-health.ts";

const DAY_MS = 86_400_000;
const TITLE_MAX_LENGTH = 300;
const DETAIL_MAX_LENGTH = 2000;

/** An alert the system turns into a plan: the origin, the site it belongs to, and the text of the plan. */
export type PlanAlert = {
  sourceType: ActionPlanSourceType;
  sourceRef: string;
  title: string;
  detail: string;
  siteId: string;
  productId: string;
};

/** On-hand stock of one batch at one site that expires within the window, or already has. */
export type ExpiringBatchRow = {
  siteId: string;
  batchId: string;
  productId: string;
  batchNumber: string;
  /** YYYY-MM-DD. */
  expiryDate: string;
  quantityOnHand: number;
};

/** A product the catalog lists, with its base-unit price today (null when none qualifies). */
export type ListedProduct = { productId: string; productName: string; unitPrice: number | null };

const fitText = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

/** The name the catalog gives a product, else its short id (the catalog no longer lists inactive products). */
const nameOf = (names: ReadonlyMap<string, string>, productId: string): string =>
  names.get(productId) ?? productId.slice(0, 8);

/** The source keys are the ones staff-web builds for a manual plan, so a manual and an automatic plan collide. */
export const replenishmentRef = (siteId: string, productId: string): string => `replenishment:${siteId}:${productId}`;
export const expiryRef = (siteId: string, batchId: string): string => `expiry:${siteId}:${batchId}`;
export const deadStockRef = (siteId: string, productId: string): string => `dead_stock:${siteId}:${productId}`;
export const priceWarningRef = (productId: string): string => `price_warning:${productId}`;

export const replenishmentAlerts = (
  siteId: string,
  suggestions: readonly ReplenishmentSuggestion[],
  names: ReadonlyMap<string, string>,
): PlanAlert[] =>
  suggestions.map((suggestion) => ({
    sourceType: "replenishment",
    sourceRef: replenishmentRef(siteId, suggestion.productId),
    title: fitText(`Bổ sung ${nameOf(names, suggestion.productId)}`, TITLE_MAX_LENGTH),
    detail: fitText(`Đề xuất đặt ${suggestion.suggestedQuantity} đơn vị.`, DETAIL_MAX_LENGTH),
    siteId,
    productId: suggestion.productId,
  }));

export const expiryAlerts = (
  batches: readonly ExpiringBatchRow[],
  today: string,
  names: ReadonlyMap<string, string>,
): PlanAlert[] =>
  batches.map((batch) => ({
    sourceType: "expiry",
    sourceRef: expiryRef(batch.siteId, batch.batchId),
    title: fitText(
      `${batch.expiryDate < today ? "Lô đã hết hạn" : "Lô sắp hết hạn"}: ${nameOf(names, batch.productId)}`,
      TITLE_MAX_LENGTH,
    ),
    detail: fitText(
      `Lô ${batch.batchNumber}, hạn dùng ${batch.expiryDate}, tồn ${batch.quantityOnHand} đơn vị.`,
      DETAIL_MAX_LENGTH,
    ),
    siteId: batch.siteId,
    productId: batch.productId,
  }));

/** Dead stock: stock on hand at a site whose last ledger movement is older than the window, or that has none. */
export const deadStockAlerts = (
  rows: readonly StockHealthRow[],
  now: Date,
  names: ReadonlyMap<string, string>,
): PlanAlert[] =>
  rows
    .filter(
      (row) =>
        row.onHand > 0 &&
        (row.lastMovementAt === null || Date.parse(row.lastMovementAt) < now.getTime() - DEAD_STOCK_DAYS * DAY_MS),
    )
    .map((row) => ({
      sourceType: "dead_stock",
      sourceRef: deadStockRef(row.siteId, row.productId),
      title: fitText(`Xử lý hàng tồn lâu: ${nameOf(names, row.productId)}`, TITLE_MAX_LENGTH),
      detail: fitText(`Tồn ${row.onHand} đơn vị, không có giao dịch trong ${DEAD_STOCK_DAYS} ngày.`, DETAIL_MAX_LENGTH),
      siteId: row.siteId,
      productId: row.productId,
    }));

/**
 * Price warning: a listed product with stock on hand and no published price. The key has no site, so one plan covers the
 * product; it is filed at the site that holds the most of it (the lowest site id on a tie), where its owner is found.
 */
export const priceWarningAlerts = (
  rows: readonly StockHealthRow[],
  products: readonly ListedProduct[],
): PlanAlert[] => {
  const unpriced = new Set(
    products.filter((product) => product.unitPrice === null).map((product) => product.productId),
  );
  const biggest = new Map<string, StockHealthRow>();
  for (const row of rows) {
    if (row.onHand <= 0 || !unpriced.has(row.productId)) continue;
    const best = biggest.get(row.productId);
    if (!best || row.onHand > best.onHand || (row.onHand === best.onHand && row.siteId < best.siteId)) {
      biggest.set(row.productId, row);
    }
  }
  const names = new Map(products.map((product) => [product.productId, product.productName]));
  return [...biggest.values()].map((row) => ({
    sourceType: "price_warning",
    sourceRef: priceWarningRef(row.productId),
    title: fitText(`Thiếu giá bán: ${nameOf(names, row.productId)}`, TITLE_MAX_LENGTH),
    detail: "Chưa có giá bán công bố cho sản phẩm này, nên tồn chưa được định giá.",
    siteId: row.siteId,
    productId: row.productId,
  }));
};
