import type { ActionPlanSourceType } from "./contract.ts";
import { expiryState } from "./plan-state.ts";

/** A plan the create drawer starts from. Its title and detail are editable there before the plan is saved. */
export type ActionPlanDraft = {
  sourceType: ActionPlanSourceType;
  sourceRef: string;
  title: string;
  detail?: string | undefined;
  siteId?: string | undefined;
  productId?: string | undefined;
};

export const TITLE_MAX_LENGTH = 300;
export const DETAIL_MAX_LENGTH = 2000;

/** Cuts text to `max` characters, ending with an ellipsis when it had to be cut. */
export const fitText = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

export const replenishmentRef = (siteId: string, productId: string): string => `replenishment:${siteId}:${productId}`;

export const expiryRef = (siteId: string, batchId: string): string => `expiry:${siteId}:${batchId}`;

export const deadStockRef = (siteId: string, productId: string): string => `dead_stock:${siteId}:${productId}`;

export type ReplenishmentSource = {
  siteId: string;
  productId: string;
  productName: string;
  suggestedQuantity: number;
  /** The supplier the line is for, or `null` while none is chosen. */
  supplierName: string | null;
};

export const replenishmentDraft = (source: ReplenishmentSource): ActionPlanDraft => ({
  sourceType: "replenishment",
  sourceRef: replenishmentRef(source.siteId, source.productId),
  title: fitText(`Bổ sung ${source.productName}`, TITLE_MAX_LENGTH),
  detail: fitText(
    `Đề xuất đặt ${source.suggestedQuantity} đơn vị, nhà cung cấp: ${source.supplierName ?? "chưa có nhà cung cấp"}.`,
    DETAIL_MAX_LENGTH,
  ),
  siteId: source.siteId,
  productId: source.productId,
});

export type DeadStockSource = {
  siteId: string;
  productId: string;
  productName: string;
  /** `null` when the analytics answer could not count the quantity. */
  quantity: number | null;
  /** The movement window the dead stock rule uses, in days. */
  deadStockDays: number;
};

export const deadStockDraft = (source: DeadStockSource): ActionPlanDraft => ({
  sourceType: "dead_stock",
  sourceRef: deadStockRef(source.siteId, source.productId),
  title: fitText(`Xử lý hàng tồn lâu: ${source.productName}`, TITLE_MAX_LENGTH),
  detail: fitText(
    `Tồn ${source.quantity ?? "chưa rõ"} đơn vị, không có giao dịch trong ${source.deadStockDays} ngày.`,
    DETAIL_MAX_LENGTH,
  ),
  siteId: source.siteId,
  productId: source.productId,
});

export type ExpiringBatchSource = {
  siteId: string;
  batchId: string;
  productId: string;
  productName: string;
  batchNumber: string;
  /** YYYY-MM-DD. */
  expiryDate: string;
  quantityOnHand: number;
  /** YYYY-MM-DD, the day the state is read against. */
  today: string;
};

export const expiringBatchDraft = (source: ExpiringBatchSource): ActionPlanDraft => {
  const expired = expiryState(source.expiryDate, source.today) === "expired";
  return {
    sourceType: "expiry",
    sourceRef: expiryRef(source.siteId, source.batchId),
    title: fitText(`${expired ? "Lô đã hết hạn" : "Lô sắp hết hạn"}: ${source.productName}`, TITLE_MAX_LENGTH),
    detail: fitText(
      `Lô ${source.batchNumber}, hạn dùng ${source.expiryDate}, tồn ${source.quantityOnHand} đơn vị.`,
      DETAIL_MAX_LENGTH,
    ),
    siteId: source.siteId,
    productId: source.productId,
  };
};
