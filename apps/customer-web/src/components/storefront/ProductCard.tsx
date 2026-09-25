import { Badge, Button, cn } from "@pharmacy/ui";

import type { CatalogPrice, CatalogProduct, CatalogUnit } from "../../customer-api.ts";
import { activeUnit, categoryLabel, priceFor, productMetadataLabel } from "../../storefront/catalog.ts";
import { formatMoney } from "../../storefront/format.ts";
import { ProductTile } from "./ProductTile.tsx";

type ProductCardProps = {
  product: CatalogProduct;
  priceIndex: Map<string, CatalogPrice>;
  inStock: boolean | undefined;
  adding: boolean;
  onAdd: (product: CatalogProduct, unit: CatalogUnit) => void;
};

export const ProductCard = ({ product, priceIndex, inStock, adding, onAdd }: ProductCardProps): React.JSX.Element => {
  const unit = activeUnit(product);
  const price = unit ? priceFor(priceIndex, product.id, unit.id) : undefined;
  const unavailable = inStock === false;
  const productDetails = productMetadataLabel(product);

  return (
    <article className="group flex flex-col rounded-lg border border-line bg-surface p-3 transition-shadow hover:shadow-md">
      <div className="relative">
        <ProductTile name={product.name} seed={product.sku} imageUrl={product.imageUrl} />
        <div className="absolute left-2 top-2">
          {unavailable ? (
            <Badge variant="danger">Hết hàng</Badge>
          ) : inStock === true ? (
            <Badge variant="secondary">Còn hàng</Badge>
          ) : (
            <Badge variant="outline">Đang cập nhật</Badge>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col pt-3">
        <h3 className="line-clamp-2 text-sm font-medium text-ink" title={product.name}>
          {product.name}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-muted">{product.manufacturer ?? "Đang cập nhật nhà sản xuất"}</p>
        {productDetails ? <p className="mt-1 line-clamp-2 text-xs text-muted-soft">{productDetails}</p> : null}
        <p className="mt-1 text-xs text-muted-soft">
          {categoryLabel(product.category)}
          {unit ? ` · ${unit.unitName}` : ""}
        </p>
        <div className="mt-3 flex-1" />
        {price && unit ? (
          <p className={cn("text-base font-semibold", unavailable ? "text-muted" : "text-danger")}>
            {formatMoney(price.unitPrice, price.currency)}
            <span className="text-xs font-normal text-muted"> / {unit.unitName}</span>
          </p>
        ) : (
          <p className="text-sm font-medium text-muted">Liên hệ để báo giá</p>
        )}
      </div>
      <Button
        className="mt-3 w-full"
        size="sm"
        variant={unavailable ? "secondary" : "primary"}
        disabled={adding || !unit}
        onClick={() => unit && onAdd(product, unit)}
      >
        {adding ? "Đang thêm..." : "Chọn mua"}
      </Button>
    </article>
  );
};
