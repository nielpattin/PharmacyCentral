import { Badge, Button, Input } from "@pharmacy/ui";
import { useState } from "react";

import type { CatalogPrice, CatalogProduct, CatalogUnit } from "../../customer-api.ts";
import { activeUnit, priceFor, productMetadataLabel } from "../../storefront/catalog.ts";
import { formatMoney, formatQuantity } from "../../storefront/format.ts";
import { ProductTile } from "../storefront/ProductTile.tsx";
import { IconPlus, IconSearch } from "../storefront/icons.tsx";

/** Rows shown before the shopper asks for the rest, so the picker never floods the page with the whole catalogue. */
const COLLAPSED_ROWS = 8;

type ProductPickerProps = {
  products: CatalogProduct[];
  priceIndex: Map<string, CatalogPrice>;
  pricesPending: boolean;
  stockIndex: Map<string, boolean>;
  /** Quantity of each product already in the cart, keyed by product id. */
  cartQuantities: Map<string, number>;
  searchTerm: string;
  loading: boolean;
  addingProductId: string | undefined;
  busy: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onAdd: (product: CatalogProduct, unit: CatalogUnit) => void;
};

export const ProductPicker = ({
  products,
  priceIndex,
  pricesPending,
  stockIndex,
  cartQuantities,
  searchTerm,
  loading,
  addingProductId,
  busy,
  onSearchChange,
  onSearchSubmit,
  onAdd,
}: ProductPickerProps): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? products : products.slice(0, COLLAPSED_ROWS);
  const hidden = products.length - rows.length;

  return (
    <div className="grid gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <div className="relative min-w-40 flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-soft" />
          <Input
            className="pl-9"
            aria-label="Tìm kiếm sản phẩm"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Tìm theo tên thuốc, hoạt chất hoặc mã SKU"
          />
        </div>
        <Button type="submit" variant="outline">
          Tìm kiếm
        </Button>
      </form>

      {loading ? (
        <p role="status" className="text-sm text-muted">
          Đang tải sản phẩm…
        </p>
      ) : null}

      {!loading && products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface-soft/60 px-6 py-8 text-center">
          <p className="text-sm font-medium text-ink">Không tìm thấy sản phẩm phù hợp</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Thử tìm bằng tên gốc, hoạt chất hoặc mã SKU khác. Nhân viên nhà thuốc có thể kiểm tra thêm khi bạn đến.
          </p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {rows.map((product) => {
            const unit = activeUnit(product);
            const price = unit ? priceFor(priceIndex, product.id, unit.id) : undefined;
            const metadata = productMetadataLabel(product);
            const inCart = cartQuantities.get(product.id) ?? 0;
            const adding = addingProductId === product.id;
            return (
              <li
                key={product.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-primary/40"
              >
                <ProductTile
                  name={product.name}
                  seed={product.sku}
                  imageUrl={product.imageUrl}
                  className="size-14"
                  monogramClassName="text-base"
                />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-ink" title={product.name}>
                    {product.name}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                    {[product.manufacturer, metadata, unit?.unitName].filter(Boolean).join(" · ") ||
                      `SKU ${product.sku}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {price && unit ? (
                      <span className="text-sm font-semibold text-danger">
                        {formatMoney(price.unitPrice, price.currency)}
                        <span className="text-xs font-normal text-muted"> / {unit.unitName}</span>
                      </span>
                    ) : pricesPending ? (
                      <span className="block h-4 w-20 animate-pulse rounded bg-surface-soft" aria-hidden="true" />
                    ) : (
                      <span className="text-xs text-muted">Liên hệ để báo giá</span>
                    )}
                    {stockIndex.get(product.id) === false ? <Badge variant="danger">Hết hàng</Badge> : null}
                    {inCart > 0 ? <Badge variant="secondary">Trong giỏ: {formatQuantity(inCart)}</Badge> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={inCart > 0 ? "outline" : "primary"}
                  className="shrink-0"
                  disabled={busy || adding || !unit}
                  onClick={() => unit && onAdd(product, unit)}
                >
                  <IconPlus className="size-3.5" />
                  {adding ? "Đang thêm" : "Thêm"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {hidden > 0 || expanded ? (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Thu gọn danh sách" : `Xem tất cả ${products.length} sản phẩm`}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
