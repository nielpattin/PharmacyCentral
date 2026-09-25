import { Alert, Select } from "@pharmacy/ui";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { listAvailability, listProducts, listPublishedPrices } from "../customer-api.ts";
import {
  buildPriceIndex,
  buildStockIndex,
  SORT_OPTIONS,
  sortProducts,
  uniqueCategories,
  type SortMode,
} from "../storefront/catalog.ts";
import { buildCategoryPages } from "../storefront/navigation.ts";
import { Link } from "../components/storefront/Link.tsx";
import { ProductGrid, type ProductListStatus } from "../components/storefront/ProductGrid.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { IconChevronRight } from "../components/storefront/icons.tsx";

export const CategoryPage = (): React.JSX.Element => {
  const { slug } = useParams({ from: "/danh-muc/$slug" });
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortMode>("default");

  const taxonomyQuery = useQuery({
    queryKey: ["products", { limit: 100 }],
    queryFn: () => listProducts({ limit: 100 }),
  });
  const categories = useMemo(() => uniqueCategories(taxonomyQuery.data ?? []), [taxonomyQuery.data]);
  const pages = useMemo(() => buildCategoryPages(categories), [categories]);
  const page =
    pages.find((candidate) => candidate.slug === slug) ??
    pages.flatMap((candidate) => candidate.children).find((child) => child.slug === slug);
  const parent = pages.find((candidate) => candidate.children.some((child) => child.slug === slug));
  const categoryValues = page?.categories ?? [];

  const productsQuery = useQuery({
    queryKey: ["category-products", { slug }],
    queryFn: () =>
      Promise.all(categoryValues.map((category) => listProducts({ category, limit: 100 }))).then((rows) => rows.flat()),
    enabled: categoryValues.length > 0,
  });
  const pricesQuery = useQuery({ queryKey: ["published-prices"], queryFn: listPublishedPrices });
  const availabilityQuery = useQuery({ queryKey: ["availability"], queryFn: () => listAvailability() });

  const products = productsQuery.data ?? [];
  const status: ProductListStatus = productsQuery.isPending ? "loading" : productsQuery.isError ? "error" : "ready";
  const queryError = pricesQuery.error ?? availabilityQuery.error ?? taxonomyQuery.error ?? productsQuery.error;
  const error =
    queryError instanceof Error ? queryError.message : queryError ? "Không tải được dữ liệu danh mục" : undefined;
  const priceIndex = useMemo(
    () => buildPriceIndex(pricesQuery.data ?? [], new Date().toISOString().slice(0, 10)),
    [pricesQuery.data],
  );
  const stockIndex = useMemo(() => buildStockIndex(availabilityQuery.data ?? []), [availabilityQuery.data]);
  const visibleProducts = useMemo(() => sortProducts(products, sort, priceIndex), [products, sort, priceIndex]);

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader
        categories={categories}
        activeSlug={slug}
        onSearch={(term) => void navigate({ to: "/", search: { q: term } })}
      />

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        {!page ? (
          taxonomyQuery.isPending ? (
            <p className="text-sm text-muted">Đang tải danh mục…</p>
          ) : (
            <div className="rounded-md border border-dashed border-line p-8 text-center">
              <p className="text-sm font-medium text-ink">Không tìm thấy danh mục này</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Danh mục có thể đã được đổi tên. Chọn danh mục khác trong thanh menu phía trên.
              </p>
              <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href="/">
                Về trang chủ
              </Link>
            </div>
          )
        ) : (
          <>
            <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Đường dẫn">
              <Link className="hover:text-primary" href="/">
                Trang chủ
              </Link>
              {parent ? (
                <>
                  <IconChevronRight className="size-3" />
                  <Link className="hover:text-primary" href={`/danh-muc/${parent.slug}`}>
                    {parent.label}
                  </Link>
                </>
              ) : null}
              <IconChevronRight className="size-3" />
              <span className="font-medium text-ink">{page.label}</span>
            </nav>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-ink">{page.label}</h1>
                <p className="mt-0.5 text-sm text-muted">
                  {status === "ready" ? `${visibleProducts.length} sản phẩm` : "Đang tải sản phẩm"}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <span className="shrink-0">Sắp xếp</span>
                <Select
                  aria-label="Sắp xếp sản phẩm"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortMode)}
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

            {error ? <Alert variant="danger">{error}</Alert> : null}

            {page.children.length > 0 ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {page.children.map((child) => (
                  <li key={child.slug}>
                    <Link
                      className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:text-primary"
                      href={`/danh-muc/${child.slug}`}
                    >
                      {child.label}
                      <IconChevronRight className="size-4 shrink-0 text-muted-soft" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <ProductGrid
              products={visibleProducts}
              status={status}
              priceIndex={priceIndex}
              pricesPending={pricesQuery.isPending}
              stockIndex={stockIndex}
              empty={
                <div className="rounded-md border border-dashed border-line p-8 text-center">
                  <p className="text-sm font-medium text-ink">Chưa có sản phẩm trong {page.label}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                    Danh mục này đang được cập nhật. Chọn danh mục khác trong thanh menu phía trên.
                  </p>
                </div>
              }
            />
          </>
        )}
      </main>

      <SiteFooter categories={categories} />
    </div>
  );
};
