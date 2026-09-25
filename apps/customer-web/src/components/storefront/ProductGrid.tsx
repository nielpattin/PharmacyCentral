import { Alert } from "@pharmacy/ui";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { addCartLine, type CatalogPrice, type CatalogProduct, type CatalogUnit } from "../../customer-api.ts";
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
};

export const ProductGrid = ({
  products,
  status,
  error,
  empty,
  priceIndex,
  stockIndex,
}: ProductGridProps): React.JSX.Element => {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [addError, setAddError] = useState<string>();
  const addMutation = useMutation({
    mutationFn: ({ productId, unitId }: { productId: string; unitId: string }) => addCartLine(productId, unitId, 1),
    onSuccess: (cart) => {
      queryClient.setQueryData(["cart"], cart);
    },
  });
  const addingId = addMutation.isPending ? addMutation.variables?.productId : undefined;

  const addToCart = async (product: CatalogProduct, unit: CatalogUnit): Promise<void> => {
    setAddError(undefined);
    setNotice(undefined);
    try {
      await addMutation.mutateAsync({ productId: product.id, unitId: unit.id });
      setNotice(`Đã thêm “${product.name}” vào giỏ hàng`);
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : "Không thêm được sản phẩm vào giỏ hàng");
    }
  };

  return (
    <>
      {error ? (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      ) : null}
      {addError ? (
        <Alert variant="danger" className="mb-4">
          {addError}
        </Alert>
      ) : null}
      {notice ? <Alert className="mb-4">{notice}</Alert> : null}

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
              inStock={stockIndex.get(product.id)}
              adding={addingId === product.id}
              onAdd={(target, unit) => void addToCart(target, unit)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};
