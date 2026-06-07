import styles from "./ProductsPage.module.css";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import {
   createProduct,
   deleteProduct,
   loadProducts,
   updateProduct,
   type ProductDto,
   type ProductUpsertRequest,
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

export default function ProductsPage() {
   const t = useT();
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedProductId, setSelectedProductId] = useState("");
   const [editorTargetId, setEditorTargetId] = useState<string | null>(null);
   const [query, setQuery] = useState("");
   const [isSaving, setIsSaving] = useState(false);
   const [isDeleting, setIsDeleting] = useState(false);
   const [createToken, setCreateToken] = useState(0);

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
            product.unit ?? "",
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

   useMountEffect(() => {
      void refreshProducts();
   });

   async function refreshProducts(preferredSelectedProductId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const data = await loadProducts();
         setProducts(data);

         const nextSelectedProductId = preferredSelectedProductId ?? selectedProductId;
         const resolvedSelectedProductId = data.some((product) => product.id === nextSelectedProductId)
            ? nextSelectedProductId
            : (data[0]?.id ?? "");

         setSelectedProductId(resolvedSelectedProductId);
         setEditorTargetId((current) => {
            if (current === null) {
               return null;
            }

            return data.some((product) => product.id === current) ? current : resolvedSelectedProductId || null;
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
            unit: values.unit.trim(),
            manufacturer: values.manufacturer.trim(),
            status: normalizeText(values.status) || "Active",
            notes: values.notes.trim(),
            isActive: values.isActive,
         };

         const result =
            editorTargetId === null ? await createProduct(request) : await updateProduct(editorTargetId, request);
         await refreshProducts(result.id);
         setEditorTargetId(result.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveProduct"));
      } finally {
         setIsSaving(false);
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
         await refreshProducts();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.deleteProduct"));
      } finally {
         setIsDeleting(false);
      }
   }

   function handleSelectProduct(productId: string) {
      setSelectedProductId(productId);
      setEditorTargetId(productId);
   }

   function handleNewProduct() {
      setCreateToken((current) => current + 1);
      setSelectedProductId("");
      setEditorTargetId(null);
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
