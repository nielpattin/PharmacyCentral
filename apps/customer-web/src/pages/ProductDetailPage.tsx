import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select, cn } from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  getProduct,
  listAvailability,
  listProducts,
  listPublishedPrices,
  listStores,
  type CatalogUnit,
} from "../customer-api.ts";
import { useAddToCart } from "../hooks/useAddToCart.ts";
import {
  activeUnit,
  buildPriceIndex,
  buildStockIndex,
  categoryLabel,
  priceFor,
  productMetadataLabel,
  uniqueCategories,
} from "../storefront/catalog.ts";
import { formatDateTime, formatMoney } from "../storefront/format.ts";
import { buildCategoryPages } from "../storefront/navigation.ts";
import { CartFeedback } from "../components/storefront/CartFeedback.tsx";
import { Link } from "../components/storefront/Link.tsx";
import { ProductGrid } from "../components/storefront/ProductGrid.tsx";
import { ProductTile } from "../components/storefront/ProductTile.tsx";
import { SectionHeading } from "../components/storefront/SectionHeading.tsx";
import { SiteFooter } from "../components/storefront/SiteFooter.tsx";
import { SiteHeader } from "../components/storefront/SiteHeader.tsx";
import { IconCart, IconChevronRight, IconShield, IconStore, IconTruck } from "../components/storefront/icons.tsx";

const MAX_QUANTITY = 999;
const RELATED_LIMIT = 5;

const SERVICE_PROMISES = [
  { icon: <IconShield />, label: "Thuốc chính hãng" },
  { icon: <IconTruck />, label: "Giao hàng tận nơi" },
  { icon: <IconStore />, label: "Nhận tại nhà thuốc" },
];

const ProductDetailLoading = (): React.JSX.Element => (
  // Deliberately neutral: a deep link may resolve to a product that no longer exists, so this must not promise a
  // product page (image, price card) that the fetch can still take away.
  <p role="status" className="py-16 text-center text-sm text-muted">
    Đang tải sản phẩm…
  </p>
);

export const ProductDetailPage = (): React.JSX.Element => {
  const { productId } = useParams({ from: "/san-pham/$productId" });
  const navigate = useNavigate();
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [quantityText, setQuantityText] = useState("1");

  const productQuery = useQuery({ queryKey: ["product", productId], queryFn: () => getProduct(productId) });
  const pricesQuery = useQuery({ queryKey: ["published-prices"], queryFn: listPublishedPrices });
  const availabilityQuery = useQuery({ queryKey: ["availability"], queryFn: () => listAvailability() });
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: listStores });
  const taxonomyQuery = useQuery({
    queryKey: ["products", { limit: 100 }],
    queryFn: () => listProducts({ limit: 100 }),
  });

  const product = productQuery.data;
  const category = product?.category ?? undefined;
  const relatedQuery = useQuery({
    queryKey: ["related-products", { productId, category: category ?? null }],
    queryFn: () => listProducts({ category, limit: 12 }),
    enabled: Boolean(category),
  });

  const categories = useMemo(() => uniqueCategories(taxonomyQuery.data ?? []), [taxonomyQuery.data]);
  const pages = useMemo(() => buildCategoryPages(categories), [categories]);
  const categoryPage = category ? pages.find((page) => page.categories.includes(category)) : undefined;
  const priceIndex = useMemo(
    () => buildPriceIndex(pricesQuery.data ?? [], new Date().toISOString().slice(0, 10)),
    [pricesQuery.data],
  );
  const stockIndex = useMemo(() => buildStockIndex(availabilityQuery.data ?? []), [availabilityQuery.data]);
  const stockRows = useMemo(
    () => (availabilityQuery.data ?? []).filter((row) => row.productId === productId),
    [availabilityQuery.data, productId],
  );
  const related = useMemo(
    () => (relatedQuery.data ?? []).filter((candidate) => candidate.id !== productId).slice(0, RELATED_LIMIT),
    [relatedQuery.data, productId],
  );

  const units = product?.units ?? [];
  const unit: CatalogUnit | undefined =
    units.find((candidate) => candidate.id === selectedUnitId) ?? (product ? activeUnit(product) : undefined);
  const price = product && unit ? priceFor(priceIndex, product.id, unit.id) : undefined;
  const quantity = Math.min(MAX_QUANTITY, Math.max(1, Number.parseInt(quantityText, 10) || 1));
  const stock = product ? stockIndex.get(product.id) : undefined;
  const unavailable = stock === false;
  const { add, pendingProductId, error: addError, notice } = useAddToCart();
  const adding = pendingProductId !== undefined;

  const productError = productQuery.error instanceof Error ? productQuery.error.message : undefined;
  const sideError =
    pricesQuery.error ?? availabilityQuery.error ?? storesQuery.error ?? taxonomyQuery.error ?? relatedQuery.error;
  const sideErrorMessage =
    sideError instanceof Error ? sideError.message : sideError ? "Không tải được thông tin giá và tồn kho" : undefined;

  const addToCart = async (buyNow: boolean): Promise<void> => {
    if (!product || !unit) return;
    const added = await add({
      productId: product.id,
      productUnitId: unit.id,
      quantity,
      productName: product.name,
    });
    if (added && buyNow) void navigate({ to: "/don-hang" });
  };

  const facts = (
    product
      ? [
          { label: "Mã sản phẩm (SKU)", value: product.sku },
          { label: "Danh mục", value: categoryLabel(product.category) },
          { label: "Nhà sản xuất", value: product.manufacturer },
          { label: "Hoạt chất", value: product.activeIngredient ?? product.genericName },
          { label: "Công dụng", value: product.indications },
          { label: "Hàm lượng", value: product.strength },
          { label: "Dạng bào chế", value: product.dosageForm },
          { label: "Quy cách đóng gói", value: product.packageDescription },
          { label: "Số đăng ký", value: product.registrationNumber },
          { label: "Mã vạch", value: product.barcode },
          { label: "Đơn vị bán", value: units.map((candidate) => candidate.unitName).join(", ") || null },
        ]
      : []
  ).filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
  const metadata = product ? productMetadataLabel(product) : "";

  return (
    <div className="min-h-screen bg-background text-ink">
      <SiteHeader categories={categories} onSearch={(term) => void navigate({ to: "/", search: { q: term } })} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {productQuery.isPending ? <ProductDetailLoading /> : null}

        {productQuery.isError ? (
          <div className="rounded-md border border-dashed border-line p-8 text-center">
            <p className="text-sm font-medium text-ink">Không mở được sản phẩm này</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              {productError ?? "Sản phẩm có thể đã ngừng bán hoặc đường dẫn không còn đúng."}
            </p>
            <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href="/">
              Về trang chủ
            </Link>
          </div>
        ) : null}

        {product ? (
          <>
            <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Đường dẫn">
              <Link className="hover:text-primary" href="/">
                Trang chủ
              </Link>
              <IconChevronRight className="size-3" />
              {categoryPage ? (
                <Link className="hover:text-primary" href={`/danh-muc/${categoryPage.slug}`}>
                  {categoryPage.label}
                </Link>
              ) : (
                <span>{categoryLabel(product.category)}</span>
              )}
              <IconChevronRight className="size-3" />
              <span className="min-w-0 truncate font-medium text-ink">{product.name}</span>
            </nav>

            {sideErrorMessage ? <Alert variant="danger">{sideErrorMessage}</Alert> : null}

            <section className="grid gap-6 lg:grid-cols-2">
              <ProductTile
                name={product.name}
                seed={product.sku}
                imageUrl={product.imageUrl}
                className="rounded-lg"
                monogramClassName="text-6xl"
              />

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="primary">{categoryLabel(product.category)}</Badge>
                    {unavailable ? (
                      <Badge variant="danger">Hết hàng</Badge>
                    ) : stock === true ? (
                      <Badge variant="secondary">Còn hàng</Badge>
                    ) : (
                      <Badge variant="outline">Đang cập nhật tồn kho</Badge>
                    )}
                    {product.prescriptionRequired ? <Badge variant="danger">Thuốc kê đơn</Badge> : null}
                  </div>
                  <h1 className="text-xl font-semibold text-ink sm:text-2xl">{product.name}</h1>
                  <p className="text-sm text-muted">{product.manufacturer ?? "Đang cập nhật nhà sản xuất"}</p>
                  {metadata ? <p className="text-sm text-muted-soft">{metadata}</p> : null}
                </div>

                <div className="rounded-lg border border-line bg-surface p-4">
                  {price && unit ? (
                    <p className={cn("text-2xl font-semibold", unavailable ? "text-muted" : "text-danger")}>
                      {formatMoney(price.unitPrice, price.currency)}
                      <span className="text-sm font-normal text-muted"> / {unit.unitName}</span>
                    </p>
                  ) : pricesQuery.isPending ? (
                    <span className="block h-8 w-40 animate-pulse rounded bg-surface-soft" aria-hidden="true" />
                  ) : (
                    <p className="text-lg font-medium text-muted">Liên hệ để báo giá</p>
                  )}

                  {units.length > 0 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        <span className="text-muted">Đơn vị bán</span>
                        {units.length > 1 ? (
                          <Select
                            aria-label="Chọn đơn vị bán"
                            value={unit?.id ?? ""}
                            onChange={(event) => setSelectedUnitId(event.target.value)}
                          >
                            {units.map((candidate) => {
                              const candidatePrice = priceFor(priceIndex, product.id, candidate.id);
                              return (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.unitName}
                                  {candidatePrice
                                    ? ` · ${formatMoney(candidatePrice.unitPrice, candidatePrice.currency)}`
                                    : ""}
                                </option>
                              );
                            })}
                          </Select>
                        ) : (
                          <p className="flex h-9 items-center rounded-md border border-line bg-surface-soft px-3 text-ink">
                            {unit?.unitName ?? "Đang cập nhật"}
                          </p>
                        )}
                      </label>

                      <div className="space-y-1 text-sm">
                        <span className="block text-muted">Số lượng</span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Giảm số lượng"
                            disabled={quantity <= 1}
                            onClick={() => setQuantityText(String(quantity - 1))}
                          >
                            −
                          </Button>
                          <Input
                            aria-label="Số lượng"
                            inputMode="numeric"
                            className="h-9 w-16 text-center"
                            value={quantityText}
                            onChange={(event) => setQuantityText(event.target.value.replace(/\D/g, "").slice(0, 3))}
                            onBlur={() => setQuantityText(String(quantity))}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Tăng số lượng"
                            disabled={quantity >= MAX_QUANTITY}
                            onClick={() => setQuantityText(String(quantity + 1))}
                          >
                            +
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Alert variant="danger" className="mt-4">
                      Sản phẩm chưa có đơn vị bán nên chưa thể đặt hàng.
                    </Alert>
                  )}

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="sm:flex-1"
                      size="lg"
                      variant={unavailable ? "secondary" : "primary"}
                      disabled={adding || !unit}
                      onClick={() => void addToCart(false)}
                    >
                      <IconCart />
                      {adding ? "Đang thêm..." : "Thêm vào giỏ hàng"}
                    </Button>
                    <Button
                      className="sm:flex-1"
                      size="lg"
                      variant="outline"
                      disabled={adding || !unit}
                      onClick={() => void addToCart(true)}
                    >
                      Mua ngay
                    </Button>
                  </div>
                </div>

                {/* Commitments sit with the buy box rather than under the photo, which also balances the two
                    halves of the page. */}
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                  {SERVICE_PROMISES.map((promise) => (
                    <li key={promise.label} className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                      <span className="text-primary [&_svg]:size-4">{promise.icon}</span>
                      {promise.label}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Thông tin sản phẩm</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-x-8 sm:grid-cols-2">
                    {facts.map((fact) => (
                      <div
                        key={fact.label}
                        className="flex items-start justify-between gap-4 border-b border-line/70 py-2 text-sm last:border-0"
                      >
                        <dt className="shrink-0 text-muted">{fact.label}</dt>
                        <dd className="text-right font-medium text-ink">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tình trạng tại nhà thuốc</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {storesQuery.isPending ? <p className="text-sm text-muted">Đang tải nhà thuốc…</p> : null}
                  {(storesQuery.data ?? []).map((store) => {
                    const row = stockRows.find((candidate) => candidate.siteId === store.id);
                    return (
                      <div key={store.id} className="rounded-md border border-line p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-ink">{store.name}</p>
                          {row ? (
                            row.inStock ? (
                              <Badge variant="secondary">Còn hàng</Badge>
                            ) : (
                              <Badge variant="danger">Tạm hết hàng</Badge>
                            )
                          ) : (
                            <Badge variant="outline">Đang cập nhật</Badge>
                          )}
                        </div>
                        {store.address ? <p className="mt-1 text-xs text-muted">{store.address}</p> : null}
                        {row ? (
                          <p className="mt-1 text-xs text-muted-soft">Cập nhật {formatDateTime(row.updatedAt)}</p>
                        ) : null}
                      </div>
                    );
                  })}
                  {storesQuery.isError ? (
                    <p className="text-sm text-muted">Không tải được danh sách nhà thuốc.</p>
                  ) : null}
                </CardContent>
              </Card>

              {product.notes ? (
                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Ghi chú</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-line text-sm text-muted">{product.notes}</p>
                  </CardContent>
                </Card>
              ) : null}
            </section>

            {related.length > 0 ? (
              <section>
                <SectionHeading
                  icon={<IconCart />}
                  title="Sản phẩm cùng danh mục"
                  description={`Các sản phẩm khác trong ${categoryLabel(product.category)}`}
                  action={
                    categoryPage ? (
                      <Link
                        className="text-sm font-medium text-primary hover:underline"
                        href={`/danh-muc/${categoryPage.slug}`}
                      >
                        Xem tất cả
                      </Link>
                    ) : undefined
                  }
                />
                <ProductGrid
                  products={related}
                  status="ready"
                  priceIndex={priceIndex}
                  pricesPending={pricesQuery.isPending}
                  stockIndex={stockIndex}
                  empty={null}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </main>

      <CartFeedback notice={notice} error={addError} />
      <SiteFooter categories={categories} />
    </div>
  );
};
