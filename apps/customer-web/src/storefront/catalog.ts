import type { CatalogAvailability, CatalogPrice, CatalogProduct, CatalogUnit } from "../customer-api.ts";

const CATEGORY_LABELS: Record<string, string> = {
  Medicine: "Thuốc",
  "Medical supply": "Vật tư y tế",
  "Medical device": "Thiết bị y tế",
  Supplement: "Thực phẩm chức năng",
  Cosmetic: "Dược mỹ phẩm",
  "Personal care": "Chăm sóc cá nhân",
};

export const categoryLabel = (category: string | null): string => {
  if (!category) return "Chưa phân loại";
  return CATEGORY_LABELS[category] ?? category;
};

const TILE_TONES = [
  "bg-gradient-to-br from-primary-soft to-primary/25",
  "bg-gradient-to-br from-primary/15 to-surface-soft",
  "bg-gradient-to-br from-primary-soft to-surface-soft",
  "bg-gradient-to-br from-surface-soft to-primary/15",
] as const;

const toneIndex = (seed: string): number => {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) % 997;
  }
  return hash % TILE_TONES.length;
};

export const tileTone = (seed: string): string => TILE_TONES[toneIndex(seed)] ?? TILE_TONES[0];

export const activeUnit = (product: CatalogProduct): CatalogUnit | undefined =>
  product.units.find((unit) => unit.isDefaultSaleUnit) ??
  product.units.find((unit) => unit.isBaseUnit) ??
  [...product.units].sort((left, right) => left.sortOrder - right.sortOrder)[0];

const priceKey = (productId: string, productUnitId: string): string => `${productId}|${productUnitId}`;

export const buildPriceIndex = (prices: CatalogPrice[], today: string): Map<string, CatalogPrice> => {
  const index = new Map<string, CatalogPrice>();
  for (const price of prices) {
    if (price.status !== "Published") continue;
    if (price.effectiveFrom > today) continue;
    if (price.effectiveTo && price.effectiveTo < today) continue;
    const key = priceKey(price.productId, price.productUnitId);
    const existing = index.get(key);
    if (!existing || price.effectiveFrom > existing.effectiveFrom) index.set(key, price);
  }
  return index;
};

export const priceFor = (
  index: Map<string, CatalogPrice>,
  productId: string,
  productUnitId: string,
): CatalogPrice | undefined => index.get(priceKey(productId, productUnitId));

export const buildStockIndex = (rows: CatalogAvailability[]): Map<string, boolean> => {
  const index = new Map<string, boolean>();
  for (const row of rows) {
    if (index.get(row.productId) === true) continue;
    index.set(row.productId, row.inStock);
  }
  return index;
};

export type SortMode = "default" | "price-asc" | "price-desc" | "name";

export const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "default", label: "Mặc định" },
  { value: "price-asc", label: "Giá thấp đến cao" },
  { value: "price-desc", label: "Giá cao đến thấp" },
  { value: "name", label: "Tên A - Z" },
];

const unitPriceValue = (index: Map<string, CatalogPrice>, product: CatalogProduct): number | undefined => {
  const unit = activeUnit(product);
  if (!unit) return undefined;
  const price = priceFor(index, product.id, unit.id);
  return price ? Number(price.unitPrice) : undefined;
};

export const sortProducts = (
  products: CatalogProduct[],
  mode: SortMode,
  index: Map<string, CatalogPrice>,
): CatalogProduct[] => {
  if (mode === "default") return products;
  const sorted = [...products];
  if (mode === "name") {
    sorted.sort((left, right) => left.name.localeCompare(right.name, "vi"));
    return sorted;
  }
  sorted.sort((left, right) => {
    const leftPrice = unitPriceValue(index, left);
    const rightPrice = unitPriceValue(index, right);
    if (leftPrice === undefined && rightPrice === undefined) return left.name.localeCompare(right.name, "vi");
    if (leftPrice === undefined) return 1;
    if (rightPrice === undefined) return -1;
    return mode === "price-asc" ? leftPrice - rightPrice : rightPrice - leftPrice;
  });
  return sorted;
};

export const uniqueCategories = (products: CatalogProduct[]): Array<{ value: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.category) continue;
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value, "vi"));
};
