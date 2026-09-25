import { Button, Select } from "@pharmacy/ui";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listProducts, type CatalogPrice } from "../../customer-api.ts";
import { categoryLabel, SORT_OPTIONS, sortProducts, type SortMode } from "../../storefront/catalog.ts";
import { ProductGrid, type ProductListStatus } from "./ProductGrid.tsx";
import { SectionHeading } from "./SectionHeading.tsx";
import { IconCart } from "./icons.tsx";

export type CatalogSectionProps = {
  search: string;
  category: string | undefined;
  sort: SortMode;
  priceIndex: Map<string, CatalogPrice>;
  stockIndex: Map<string, boolean>;
  onSortChange: (sort: SortMode) => void;
  onClearFilters: () => void;
};

export const CatalogSection = ({
  search,
  category,
  sort,
  priceIndex,
  stockIndex,
  onSortChange,
  onClearFilters,
}: CatalogSectionProps): React.JSX.Element => {
  const productsQuery = useQuery({
    queryKey: ["products", { search, category }],
    queryFn: () => listProducts({ search, category }),
  });
  const products = productsQuery.data ?? [];
  const status: ProductListStatus = productsQuery.isPending ? "loading" : productsQuery.isError ? "error" : "ready";
  const loadError = productsQuery.error instanceof Error ? productsQuery.error.message : undefined;
  const hasFilters = Boolean(search || category);

  const visibleProducts = useMemo(() => sortProducts(products, sort, priceIndex), [products, sort, priceIndex]);

  return (
    <section id="san-pham" className="scroll-mt-40">
      <SectionHeading
        icon={<IconCart />}
        title={hasFilters ? "Kết quả tìm kiếm" : "Sản phẩm bán chạy"}
        description={
          status === "ready"
            ? `${visibleProducts.length} sản phẩm${search ? ` cho “${search}”` : ""}${category ? ` trong ${categoryLabel(category)}` : ""}`
            : "Đang tải danh mục sản phẩm"
        }
        action={
          <div className="flex items-center gap-2">
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={onClearFilters}>
                Xoá bộ lọc
              </Button>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-muted">
              <span className="shrink-0">Sắp xếp</span>
              <Select
                aria-label="Sắp xếp sản phẩm"
                value={sort}
                onChange={(event) => onSortChange(event.target.value as SortMode)}
                className="w-44"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        }
      />

      <ProductGrid
        products={visibleProducts}
        status={status}
        error={loadError}
        priceIndex={priceIndex}
        stockIndex={stockIndex}
        empty={
          <div className="rounded-md border border-dashed border-line p-8 text-center">
            <p className="text-sm font-medium text-ink">
              {hasFilters ? "Không tìm thấy sản phẩm phù hợp" : "Chưa có sản phẩm nào"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              {hasFilters
                ? "Thử từ khoá khác, hoặc xoá bộ lọc để xem toàn bộ danh mục sản phẩm."
                : "Danh mục sản phẩm đang được cập nhật. Vui lòng quay lại sau."}
            </p>
            {hasFilters ? (
              <Button variant="outline" className="mt-4" onClick={onClearFilters}>
                Xoá bộ lọc
              </Button>
            ) : null}
          </div>
        }
      />
    </section>
  );
};
