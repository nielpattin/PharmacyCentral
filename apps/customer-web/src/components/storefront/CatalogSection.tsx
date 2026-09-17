import { Alert, Button, Select } from "@pharmacy/ui";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addCartLine,
  listProducts,
  type CatalogPrice,
  type CatalogProduct,
  type CatalogUnit,
} from "../../customer-api.ts";
import { categoryLabel, SORT_OPTIONS, sortProducts, type SortMode } from "../../storefront/catalog.ts";
import { ProductCard } from "./ProductCard.tsx";
import { ProductGridSkeleton } from "./ProductCardSkeleton.tsx";
import { SectionHeading } from "./SectionHeading.tsx";
import { IconCart } from "./icons.tsx";

type LoadStatus = "loading" | "ready" | "error";

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
  const queryClient = useQueryClient();
  const productsQuery = useQuery({
    queryKey: ["products", { search, category }],
    queryFn: () => listProducts({ search, category }),
  });
  const products = productsQuery.data ?? [];
  const status: LoadStatus = productsQuery.isPending ? "loading" : productsQuery.isError ? "error" : "ready";
  const loadError = productsQuery.error instanceof Error ? productsQuery.error.message : undefined;
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const addMutation = useMutation({
    mutationFn: ({ productId, unitId }: { productId: string; unitId: string }) => addCartLine(productId, unitId, 1),
    onSuccess: (cart) => {
      queryClient.setQueryData(["cart"], cart);
    },
  });
  const addingId = addMutation.isPending ? addMutation.variables?.productId : undefined;
  const visibleError = error ?? loadError;

  const visibleProducts = useMemo(() => sortProducts(products, sort, priceIndex), [products, sort, priceIndex]);

  const addToCart = async (product: CatalogProduct, unit: CatalogUnit): Promise<void> => {
    setError(undefined);
    setNotice(undefined);
    try {
      await addMutation.mutateAsync({ productId: product.id, unitId: unit.id });
      setNotice(`Đã thêm “${product.name}” vào giỏ hàng`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thêm được sản phẩm vào giỏ hàng");
    }
  };

  const hasFilters = Boolean(search || category);

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

      {visibleError ? (
        <Alert variant="danger" className="mb-4">
          {visibleError}
        </Alert>
      ) : null}
      {notice ? <Alert className="mb-4">{notice}</Alert> : null}

      {status === "loading" ? <ProductGridSkeleton /> : null}

      {status === "error" ? (
        <p className="rounded-md border border-dashed border-danger/40 bg-danger-soft/40 p-6 text-center text-sm text-danger">
          Không hiển thị được sản phẩm. Vui lòng kiểm tra kết nối mạng và tải lại trang.
        </p>
      ) : null}

      {status === "ready" && visibleProducts.length === 0 ? (
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
      ) : null}

      {status === "ready" && visibleProducts.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              priceIndex={priceIndex}
              inStock={stockIndex.get(product.id)}
              adding={addingId === product.id}
              onAdd={(target, unit) => void addToCart(target, unit)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
};
