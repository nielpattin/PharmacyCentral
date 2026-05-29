import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { createGoodsReceipt, loadGoodsReceipts, loadProducts, loadSites, loadStorageLocations, loadSuppliers, type GoodsReceiptDto, type GoodsReceiptUpsertRequest, type ProductDto, type SiteDto, type StorageLocationDto, type SupplierDto } from "../api/pharmacyClient";
import { GoodsReceiptForm } from "../features/goods-receipts/GoodsReceiptForm";
import { GoodsReceiptTable } from "../features/goods-receipts/GoodsReceiptTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { normalizeText } from "./shared/pharmacyForms";
import { blankGoodsReceiptValues, type GoodsReceiptFormValues } from "./shared/goodsReceiptForms";

export default function GoodsReceiptsPage() {
   const t = useT();
   const [receipts, setReceipts] = useState<GoodsReceiptDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedGoodsReceiptId, setSelectedGoodsReceiptId] = useState("");
   const [query, setQuery] = useState("");
   const [isSaving, setIsSaving] = useState(false);
   const [createToken, setCreateToken] = useState(0);

   const selectedGoodsReceipt = useMemo(() => receipts.find((receipt) => receipt.id === selectedGoodsReceiptId) ?? null, [receipts, selectedGoodsReceiptId]);

   const visibleReceipts = useMemo(() => {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery === "") {
         return receipts;
      }

      return receipts.filter((receipt) => [receipt.receiptNumber, receipt.status, receipt.notes ?? ""].some((value) => value.toLowerCase().includes(normalizedQuery)));
   }, [query, receipts]);

   const formValues = blankGoodsReceiptValues();
   const formKey = `new-receipt-${createToken}-${JSON.stringify(formValues)}`;

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredSelectedGoodsReceiptId?: string) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [receiptData, productData, supplierData, siteData, storageLocationData] = await Promise.all([loadGoodsReceipts(), loadProducts(), loadSuppliers(), loadSites(), loadStorageLocations()]);
         setReceipts(receiptData);
         setProducts(productData);
         setSuppliers(supplierData);
         setSites(siteData);
         setStorageLocations(storageLocationData);

         const nextSelectedGoodsReceiptId = preferredSelectedGoodsReceiptId ?? selectedGoodsReceiptId;
         const resolvedSelectedGoodsReceiptId = receiptData.some((receipt) => receipt.id === nextSelectedGoodsReceiptId) ? nextSelectedGoodsReceiptId : (receiptData[0]?.id ?? "");
         setSelectedGoodsReceiptId(resolvedSelectedGoodsReceiptId);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadGoodsReceipts"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSaveGoodsReceipt(values: GoodsReceiptFormValues) {
      setIsSaving(true);
      setBannerError(null);

      try {
         const request: GoodsReceiptUpsertRequest = {
            supplierId: values.supplierId,
            siteId: values.siteId,
            storageLocationId: values.storageLocationId,
            receiptNumber: normalizeText(values.receiptNumber),
            notes: values.notes.trim() || null,
            lines: values.lines.map((line) => ({
               productId: line.productId,
               batchNumber: normalizeText(line.batchNumber),
               expiryDate: line.expiryDate,
               manufacturedDate: line.manufacturedDate || null,
               manufacturer: line.manufacturer.trim() || null,
               quantity: Number(line.quantity),
               notes: line.notes.trim() || null,
            })),
         };

         const result = await createGoodsReceipt(request);
         await refreshData(result.id);
         setCreateToken((current) => current + 1);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveGoodsReceipt"));
      } finally {
         setIsSaving(false);
      }
   }

   function handleNewReceipt() {
      setCreateToken((current) => current + 1);
      setSelectedGoodsReceiptId("");
   }

   return (
      <AppShell active="receiving" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.receiving") }]} />}>
         <div className="sites-page">
            <PageHeader title={t("receiving.title")} actions={<div className="page-actions"><Button variant="primary" onClick={handleNewReceipt}>{t("receiving.newReceipt")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className="site-workbench">
               <section className="card site-registry">
                  <div className="section">
                     <div className="section-header">
                        <div><h2 className="section-title">{t("receiving.registry")}</h2><p className="section-subtitle">{t("receiving.registryDesc")}</p></div>
                        <Badge tone="role">{isLoading ? t("receiving.loadingState") : `${visibleReceipts.length} ${t("common.records")}`}</Badge>
                     </div>
                     <div className="section-toolbar">
                        <input className="field-input site-search" type="search" placeholder={t("receiving.searchPlaceholder")} aria-label={t("receiving.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
                     </div>
                     {isLoading ? <EmptyState icon="…" title={t("receiving.loading")} description={t("receiving.fetching")} /> : receipts.length === 0 ? <EmptyState icon="0" title={t("receiving.emptyTitle")} description={t("receiving.emptyDesc")} /> : visibleReceipts.length === 0 ? <EmptyState icon="?" title={t("receiving.emptyTitle")} description={t("receiving.searchPlaceholder")} /> : <GoodsReceiptTable rows={visibleReceipts} selectedGoodsReceiptId={selectedGoodsReceipt?.id ?? ""} suppliers={suppliers} sites={sites} storageLocations={storageLocations} onSelectGoodsReceipt={setSelectedGoodsReceiptId} />}
                  </div>
               </section>
               <aside className="card site-editor">
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("receiving.editor")}</h2><p className="section-subtitle">{t("receiving.editorDesc")}</p></div></div>
                     <GoodsReceiptForm key={formKey} initialValues={formValues} isSaving={isSaving} products={products} suppliers={suppliers} sites={sites} storageLocations={storageLocations} onSubmit={handleSaveGoodsReceipt} />
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
