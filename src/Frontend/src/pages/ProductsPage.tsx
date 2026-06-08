import styles from "./ProductsPage.module.css";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import {
   archiveProductPrice,
   createProduct,
   createProductPrice,
   deleteProduct,
   loadProductPrices,
   loadProducts,
   loadSites,
   publishProductPrice,
   updateProduct,
   type ProductDto,
   type ProductPriceDto,
   type ProductUpsertRequest,
   type SiteDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { ProductForm } from "../features/products/ProductForm";
import { ProductTable } from "../features/products/ProductTable";
import {
   blankProductValues,
   normalizeText,
   productValuesFromDto,
   type ProductFormValues,
} from "./shared/pharmacyForms";

type PriceFormValues = {
   productUnitId: string;
   siteId: string;
   unitPrice: string;
   currency: string;
   effectiveFrom: string;
   effectiveTo: string;
   notes: string;
};

const today = new Date().toISOString().slice(0, 10);

const blankPriceForm: PriceFormValues = {
   productUnitId: "",
   siteId: "",
   unitPrice: "",
   currency: "VND",
   effectiveFrom: today,
   effectiveTo: "",
   notes: "",
};

export default function ProductsPage() {
   const t = useT();
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [prices, setPrices] = useState<ProductPriceDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedProductId, setSelectedProductId] = useState("");
   const [selectedPriceId, setSelectedPriceId] = useState("");
   const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
   const [query, setQuery] = useState("");
   const [isSaving, setIsSaving] = useState(false);
   const [isDeleting, setIsDeleting] = useState(false);
   const [isPriceSaving, setIsPriceSaving] = useState(false);
   const [createToken, setCreateToken] = useState(0);
   const [priceForm, setPriceForm] = useState<PriceFormValues>(blankPriceForm);

   const selectedProduct = useMemo(
      () => products.find((product) => product.id === selectedProductId) ?? null,
      [products, selectedProductId],
   );

   const visibleProducts = useMemo(() => {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery === "") {
         return products;
      }

      return products.filter((product) =>
         [
            product.sku,
            product.barcode ?? "",
            product.name,
            product.category ?? "",
            product.baseUnitName ?? "",
            ...product.units.map((unit) => unit.unitName),
            product.manufacturer ?? "",
            product.status,
            product.notes ?? "",
         ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      );
   }, [products, query]);

   const editorProduct =
      editorTargetId === null ? null : (products.find((product) => product.id === editorTargetId) ?? selectedProduct);
   const editorMode = editorTargetId === null ? "create" : "edit";
   const formValues: ProductFormValues =
      editorProduct === null ? blankProductValues() : productValuesFromDto(editorProduct);
   const formKey = `${editorTargetId ?? `new-product-${createToken}`}-${JSON.stringify(formValues)}`;

   const selectedProductPrices = useMemo(
      () => (editorProduct === null ? [] : prices.filter((price) => price.productId === editorProduct.id)),
      [editorProduct, prices],
   );
   const selectedPrice = selectedProductPrices.find((price) => price.id === selectedPriceId) ?? null;
   const priceUnits = (editorProduct?.units ?? []).slice().sort((left, right) => left.sortOrder - right.sortOrder);
   const defaultPriceUnitId = priceUnits.find((unit) => unit.isDefaultSaleUnit)?.id ?? priceUnits[0]?.id ?? "";
   const activePriceUnitId = priceUnits.some((unit) => unit.id === priceForm.productUnitId)
      ? priceForm.productUnitId
      : defaultPriceUnitId;

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredSelectedProductId?: string, preferredSelectedPriceId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [productData, priceData, siteData] = await Promise.all([
            loadProducts(),
            loadProductPrices({ limit: 500 }),
            loadSites(),
         ]);
         setProducts(productData);
         setPrices(priceData);
         setSites(siteData);

         const nextSelectedProductId = preferredSelectedProductId ?? selectedProductId;
         const resolvedSelectedProductId = productData.some((product) => product.id === nextSelectedProductId)
            ? nextSelectedProductId
            : (productData[0]?.id ?? "");

         setSelectedProductId(resolvedSelectedProductId);
         setSelectedPriceId((current) =>
            priceData.some((price) => price.id === (preferredSelectedPriceId ?? current))
               ? preferredSelectedPriceId ?? current
               : "",
         );
         setEditorTargetId((current) => {
            if (preferredSelectedProductId !== undefined) {
               return resolvedSelectedProductId || null;
            }

            if (current === null) {
               return resolvedSelectedProductId || null;
            }

            return productData.some((product) => product.id === current) ? current : resolvedSelectedProductId || null;
         });
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadProducts"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSaveProduct(values: ProductFormValues) {
      setIsSaving(true);
      setBannerError(null);

      try {
         const request: ProductUpsertRequest = {
            sku: normalizeText(values.sku),
            barcode: values.barcode.trim(),
            name: normalizeText(values.name),
            category: values.category.trim(),
            units: values.units,
            manufacturer: values.manufacturer.trim(),
            status: normalizeText(values.status) || "Active",
            notes: values.notes.trim(),
            isActive: values.isActive,
         };

         const result =
            editorTargetId === null ? await createProduct(request) : await updateProduct(editorTargetId, request);
         await refreshData(result.id);
         setEditorTargetId(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveProduct"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleCreatePrice() {
      if (editorProduct === null || activePriceUnitId === "" || priceForm.unitPrice.trim() === "") {
         return;
      }

      setIsPriceSaving(true);
      setBannerError(null);
      try {
         const created = await createProductPrice({
            productId: editorProduct.id,
            productUnitId: activePriceUnitId,
            siteId: priceForm.siteId === "" ? null : priceForm.siteId,
            unitPrice: Number(priceForm.unitPrice),
            currency: priceForm.currency.trim() || "VND",
            effectiveFrom: priceForm.effectiveFrom,
            effectiveTo: priceForm.effectiveTo === "" ? null : priceForm.effectiveTo,
            notes: priceForm.notes.trim() === "" ? null : priceForm.notes.trim(),
         });
         setPriceForm(blankPriceForm);
         await refreshData(editorProduct.id, created.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsPriceSaving(false);
      }
   }

   async function handlePublishPrice() {
      if (selectedPrice === null) return;

      setIsPriceSaving(true);
      setBannerError(null);
      try {
         const updated = await publishProductPrice(selectedPrice.id);
         await refreshData(updated.productId, updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsPriceSaving(false);
      }
   }

   async function handleArchivePrice() {
      if (selectedPrice === null) return;

      setIsPriceSaving(true);
      setBannerError(null);
      try {
         const updated = await archiveProductPrice(selectedPrice.id);
         await refreshData(updated.productId, updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsPriceSaving(false);
      }
   }

   async function handleDeleteProduct(productId: string) {
      const product = products.find((item) => item.id === productId);
      if (product === undefined || !window.confirm(t("products.confirmDelete", { sku: product.sku }))) {
         return;
      }

      setIsDeleting(true);
      setBannerError(null);

      try {
         await deleteProduct(productId);
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.deleteProduct"));
      } finally {
         setIsDeleting(false);
      }
   }

   function handleSelectProduct(productId: string) {
      setSelectedProductId(productId);
      setEditorTargetId(productId);
      setSelectedPriceId("");
      setPriceForm(blankPriceForm);
   }

   function handleNewProduct() {
      setCreateToken((current) => current + 1);
      setSelectedProductId("");
      setEditorTargetId(null);
      setSelectedPriceId("");
      setPriceForm(blankPriceForm);
   }

   return (
      <AppShell
         active="catalog"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.catalog") }]} />
         }
      >
         <div className={styles.sitesPage}>
            <PageHeader
               title={t("products.title")}
               actions={
                  <div className="page-actions">
                     <Button onClick={handleNewProduct}>{t("products.newProduct")}</Button>
                  </div>
               }
            />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className={styles.siteWorkbench}>
               <section
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteRegistry}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("products.registry")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("products.registryDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {isLoading ? t("products.loadingState") : `${visibleProducts.length} ${t("common.records")}`}
                        </Badge>
                     </div>
                     <div className="flex flex-wrap items-center gap-2">
                        <input
                           className={`h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${styles.siteSearch}`}
                           type="search"
                           placeholder={t("products.searchPlaceholder")}
                           aria-label={t("products.searchPlaceholder")}
                           value={query}
                           onChange={(event) => setQuery(event.target.value)}
                        />
                     </div>
                     {isLoading ? (
                        <EmptyState icon="…" title={t("products.loading")} description={t("products.fetching")} />
                     ) : products.length === 0 ? (
                        <EmptyState icon="0" title={t("products.emptyTitle")} description={t("products.emptyDesc")} />
                     ) : visibleProducts.length === 0 ? (
                        <EmptyState
                           icon="?"
                           title={t("products.emptyTitle")}
                           description={t("products.searchPlaceholder")}
                        />
                     ) : (
                        <ProductTable
                           rows={visibleProducts}
                           selectedProductId={selectedProduct?.id ?? ""}
                           onSelectProduct={handleSelectProduct}
                           onDeleteProduct={(productId) => void handleDeleteProduct(productId)}
                        />
                     )}
                  </div>
               </section>
               <aside
                  className={`rounded-md border border-border bg-card text-card-foreground shadow-none ${styles.siteEditor}`}
               >
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("products.editor")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("products.editorDesc")}</p>
                        </div>
                     </div>
                     {editorProduct !== null ? (
                        <section className={styles.pricePanel}>
                           <div className={styles.priceHeader}>
                              <div>
                                 <h3>Giá bán theo đơn vị</h3>
                                 <p>Tạo giá cho từng đơn vị bán của thuốc đang chọn.</p>
                              </div>
                              <Badge variant="outline">{selectedProductPrices.length} giá</Badge>
                           </div>
                           <div className={styles.priceFormGrid}>
                              <label>
                                 <span>Đơn vị bán</span>
                                 <select
                                    className={styles.control}
                                    value={activePriceUnitId}
                                    onChange={(event) =>
                                       setPriceForm((current) => ({ ...current, productUnitId: event.target.value }))
                                    }
                                 >
                                    {priceUnits.map((unit) => (
                                       <option key={unit.id} value={unit.id}>
                                          {formatUnitOption(unit, editorProduct.baseUnitName)}
                                       </option>
                                    ))}
                                 </select>
                              </label>
                              <label>
                                 <span>Cơ sở áp dụng</span>
                                 <select
                                    className={styles.control}
                                    value={priceForm.siteId}
                                    onChange={(event) => setPriceForm((current) => ({ ...current, siteId: event.target.value }))}
                                 >
                                    <option value="">Tất cả cơ sở</option>
                                    {sites.map((site) => (
                                       <option key={site.id} value={site.id}>
                                          {site.name}
                                       </option>
                                    ))}
                                 </select>
                              </label>
                              <label>
                                 <span>Giá bán</span>
                                 <input
                                    className={styles.control}
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={priceForm.unitPrice}
                                    onChange={(event) => setPriceForm((current) => ({ ...current, unitPrice: event.target.value }))}
                                 />
                              </label>
                              <label>
                                 <span>Tiền tệ</span>
                                 <input
                                    className={styles.control}
                                    maxLength={3}
                                    value={priceForm.currency}
                                    onChange={(event) => setPriceForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                                 />
                              </label>
                              <label>
                                 <span>Từ ngày</span>
                                 <input
                                    className={styles.control}
                                    type="date"
                                    value={priceForm.effectiveFrom}
                                    onChange={(event) => setPriceForm((current) => ({ ...current, effectiveFrom: event.target.value }))}
                                 />
                              </label>
                              <label>
                                 <span>Đến ngày</span>
                                 <input
                                    className={styles.control}
                                    type="date"
                                    value={priceForm.effectiveTo}
                                    onChange={(event) => setPriceForm((current) => ({ ...current, effectiveTo: event.target.value }))}
                                 />
                              </label>
                           </div>
                           <div className={styles.priceActions}>
                              <Button
                                 type="button"
                                 disabled={isPriceSaving || activePriceUnitId === "" || priceForm.unitPrice.trim() === ""}
                                 onClick={() => void handleCreatePrice()}
                              >
                                 {isPriceSaving ? t("common.saving") : "Tạo giá"}
                              </Button>
                              <Button
                                 type="button"
                                 disabled={selectedPrice === null || selectedPrice.status !== "Draft" || isPriceSaving}
                                 onClick={() => void handlePublishPrice()}
                              >
                                 Publish
                              </Button>
                              <Button
                                 type="button"
                                 variant="outline"
                                 disabled={selectedPrice === null || selectedPrice.status === "Archived" || isPriceSaving}
                                 onClick={() => void handleArchivePrice()}
                              >
                                 Archive
                              </Button>
                           </div>
                           {selectedProductPrices.length === 0 ? (
                              <EmptyState icon="₫" title="Chưa có giá bán" description="Tạo giá theo đơn vị bán để quầy thu ngân dùng đúng giá." />
                           ) : (
                              <div className={styles.priceList}>
                                 {selectedProductPrices.map((price) => (
                                    <button
                                       key={price.id}
                                       type="button"
                                       className={`${styles.priceRow}${price.id === selectedPriceId ? ` ${styles.priceRowSelected}` : ""}`}
                                       onClick={() => setSelectedPriceId(price.id)}
                                    >
                                       <span>
                                          <strong>{price.productUnitName}</strong>
                                          <small>{price.siteName ?? "Tất cả cơ sở"}</small>
                                       </span>
                                       <span>{formatMoney(price.unitPrice, price.currency)}</span>
                                       <Badge variant={price.status === "Published" ? "secondary" : price.status === "Archived" ? "outline" : "default"}>
                                          {price.status}
                                       </Badge>
                                    </button>
                                 ))}
                              </div>
                           )}
                        </section>
                     ) : null}
                     <ProductForm
                        key={formKey}
                        mode={editorMode}
                        initialValues={formValues}
                        isSaving={isSaving || isDeleting}
                        onSubmit={handleSaveProduct}
                        onDelete={editorProduct !== null ? () => handleDeleteProduct(editorProduct.id) : undefined}
                     />
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}

function formatMoney(value: number, currency: string) {
   return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value);
}

function formatUnitOption(unit: ProductDto["units"][number], baseUnitName: string | null) {
   if (unit.isBaseUnit) {
      return `${unit.unitName} (đơn vị cơ sở)`;
   }

   const baseUnit = baseUnitName ?? "đơn vị cơ sở";
   return `1 ${unit.unitName} = ${formatUnitFactor(unit.conversionFactorToBaseUnit)} ${baseUnit}`;
}

function formatUnitFactor(value: number) {
   return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(value);
}
