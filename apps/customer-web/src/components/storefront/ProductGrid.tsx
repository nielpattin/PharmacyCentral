import { Alert } from "@pharmacy/ui";

import { type CatalogPrice, type CatalogProduct, type CatalogUnit } from "../../customer-api.ts";
import { useAddToCart } from "../../hooks/useAddToCart.ts";
import { CartFeedback } from "./CartFeedback.tsx";
import { ProductCard } from "./ProductCard.tsx";
import { ProductGridSkeleton } from "./ProductCardSkeleton.tsx";

export type ProductListStatus = "loading" | "ready" | "error";

type ProductGridProps = {
  products: CatalogProduct[];
  status: ProductListStatus;
  error?: string | undefined;
  empty: React.ReactNode;
  priceIndex: Map<string, CatalogPrice>;
  stockIndex: Map<string, boolean>;
  /** True while published prices are still in flight, so cards stay neutral instead of claiming "no price". */
  pricesPending: boolean;
};

export const ProductGrid = ({
  products,
  status,
  error,
  empty,
  priceIndex,
  stockIndex,
  pricesPending,
}: ProductGridProps): React.JSX.Element => {
  const { add, pendingProductId, error: addError, notice } = useAddToCart();

  const addToCart = (product: CatalogProduct, unit: CatalogUnit): void => {
    void add({ productId: product.id, productUnitId: unit.id, quantity: 1, productName: product.name });
  };

  return (
    <>
      {error ? (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {status === "loading" ? <ProductGridSkeleton /> : null}

      {status === "error" ? (
        <p className="rounded-md border border-dashed border-danger/40 bg-danger-soft/40 p-6 text-center text-sm text-danger">
          Không hiển thị được sản phẩm. Vui lòng kiểm tra kết nối mạng và tải lại trang.
        </p>
      ) : null}

      {status === "ready" && products.length === 0 ? empty : null}

      {status === "ready" && products.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              priceIndex={priceIndex}
              pricesPending={pricesPending}
              inStock={stockIndex.get(product.id)}
              adding={pendingProductId === product.id}
              onAdd={addToCart}
            />
          ))}
        </div>
      ) : null}

      <CartFeedback notice={notice} error={addError} />
    </>
  );
};
