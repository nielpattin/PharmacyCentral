import type { CartLine, CatalogPrice, CatalogProduct } from "../customer-api.ts";
import { priceFor } from "./catalog.ts";

/**
 * A cart line joined with the catalog fields the order page renders. Prices here are the published catalogue prices
 * for display only: the sales service re-prices every line from its own active price when the order is created.
 */
export type CheckoutLine = {
  id: string;
  productId: string;
  productUnitId: string;
  productName: string;
  sku: string | undefined;
  imageUrl: string | null | undefined;
  unitName: string | undefined;
  quantity: number;
  currency: string;
  unitPrice: number | undefined;
  lineTotal: number | undefined;
  available: boolean | undefined;
};

export type CheckoutTotals = {
  /** Distinct products in the cart, which is what a shopper counts as "sản phẩm". */
  productCount: number;
  subtotal: number;
  /** Lines the catalogue has no published price for; the order total cannot be shown in full while this is non-zero. */
  unpricedCount: number;
  shippingFee: number | undefined;
  total: number;
  currency: string;
};

export const buildCheckoutLines = (
  lines: CartLine[],
  products: CatalogProduct[],
  priceIndex: Map<string, CatalogPrice>,
  stockIndex: Map<string, boolean>,
): CheckoutLine[] => {
  const catalog = new Map(products.map((product) => [product.id, product]));
  return lines.map((line) => {
    const product = catalog.get(line.productId);
    const unit = product?.units.find((candidate) => candidate.id === line.productUnitId);
    const price = priceFor(priceIndex, line.productId, line.productUnitId);
    const quantity = Number(line.quantity);
    const unitPrice = price ? Number(price.unitPrice) : undefined;
    return {
      id: line.id,
      productId: line.productId,
      productUnitId: line.productUnitId,
      productName: product?.name ?? "Sản phẩm không còn bán",
      sku: product?.sku,
      imageUrl: product?.imageUrl,
      unitName: unit?.unitName,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      currency: price?.currency ?? "VND",
      unitPrice,
      lineTotal: unitPrice === undefined ? undefined : unitPrice * quantity,
      available: stockIndex.get(line.productId),
    };
  });
};

export const checkoutTotals = (lines: CheckoutLine[], shippingFee: number | undefined): CheckoutTotals => {
  let subtotal = 0;
  let unpricedCount = 0;
  for (const line of lines) {
    if (line.lineTotal === undefined) {
      unpricedCount += 1;
      continue;
    }
    subtotal += line.lineTotal;
  }
  return {
    productCount: lines.length,
    subtotal,
    unpricedCount,
    shippingFee,
    total: subtotal + (shippingFee ?? 0),
    currency: lines[0]?.currency ?? "VND",
  };
};
