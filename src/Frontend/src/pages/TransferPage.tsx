import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { approveTransfer, cancelTransfer, createTransfer, loadInventoryBalances, loadProducts, loadSites, loadStorageLocations, loadTransfer, loadTransfers, receiveTransfer, shipTransfer, type InventoryBalanceDto, type ProductDto, type SiteDto, type StorageLocationDto, type TransferCreateRequest, type TransferOrderDetails, type TransferReceiveRequest, type TransferShipRequest } from "../api/pharmacyClient";
import { TransferDetail } from "../features/transfers/TransferDetail";
import { TransferOrderForm } from "../features/transfers/TransferOrderForm";
import { TransferOrderTable } from "../features/transfers/TransferOrderTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import { blankTransferOrderValues, type TransferOrderFormValues, type TransferReceiveFormValues, type TransferShipFormValues } from "./shared/transferForms";

const TRANSFER_STATUSES = ["Draft", "PendingApproval", "Approved", "InTransit", "Received", "Cancelled"];

export default function TransferPage() {
   const t = useT();
   const [transfers, setTransfers] = useState<TransferOrderDetails[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [inventoryBalances, setInventoryBalances] = useState<InventoryBalanceDto[]>([]);
   const [selectedId, setSelectedId] = useState("");
   const [siteFilter, setSiteFilter] = useState("");
   const [statusFilter, setStatusFilter] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [createToken, setCreateToken] = useState(0);

   const selectedTransfer = useMemo(() => transfers.find((transfer) => transfer.id === selectedId) ?? null, [transfers, selectedId]);
   const visibleTransfers = useMemo(() => transfers.filter((transfer) => (siteFilter === "" || transfer.sourceSiteId === siteFilter || transfer.destinationSiteId === siteFilter) && (statusFilter === "" || transfer.status === statusFilter)), [transfers, siteFilter, statusFilter]);
   const formValues = blankTransferOrderValues();

   useMountEffect(() => { void refreshData(); });

   async function refreshData(preferredSelectedId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [transferData, siteData, locationData, productData, balanceData] = await Promise.all([loadTransfers({ limit: 100 }), loadSites(), loadStorageLocations(), loadProducts(), loadInventoryBalances({ includeZeroBalances: false })]);
         setTransfers(transferData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);
         setInventoryBalances(balanceData);
         const nextSelectedId = preferredSelectedId ?? selectedId;
         setSelectedId(transferData.some((transfer) => transfer.id === nextSelectedId) ? nextSelectedId : (transferData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadTransfer"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleSelectTransfer(id: string) {
      setSelectedId(id);
      setBannerError(null);
      try {
         const detail = await loadTransfer(id);
         setTransfers((current) => current.some((transfer) => transfer.id === detail.id) ? current.map((transfer) => transfer.id === detail.id ? detail : transfer) : [detail, ...current]);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadTransfer"));
      }
   }

   async function handleCreateTransfer(values: TransferOrderFormValues) {
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: TransferCreateRequest = {
            sourceSiteId: values.sourceSiteId,
            sourceStorageLocationId: values.sourceStorageLocationId,
            destinationSiteId: values.destinationSiteId,
            destinationStorageLocationId: values.destinationStorageLocationId,
            notes: values.notes.trim() || null,
            lines: values.lines.map((line) => ({ productId: line.productId, productBatchId: line.productBatchId, requestedQuantity: Number(line.requestedQuantity), notes: line.notes.trim() || null })),
         };
         const result = await createTransfer(request);
         await refreshData(result.id);
         setCreateToken((current) => current + 1);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveTransfer"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleApproveTransfer() {
      if (selectedTransfer === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         await approveTransfer(selectedTransfer.id);
         await refreshData(selectedTransfer.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveTransfer"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleShipTransfer(values: TransferShipFormValues) {
      if (selectedTransfer === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: TransferShipRequest = { lines: values.lines.map((line) => ({ transferOrderLineId: line.transferOrderLineId, shippedQuantity: Number(line.shippedQuantity) })) };
         await shipTransfer(selectedTransfer.id, request);
         await refreshData(selectedTransfer.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveTransfer"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleReceiveTransfer(values: TransferReceiveFormValues) {
      if (selectedTransfer === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: TransferReceiveRequest = { lines: values.lines.map((line) => ({ transferOrderLineId: line.transferOrderLineId, receivedQuantity: Number(line.receivedQuantity) })) };
         await receiveTransfer(selectedTransfer.id, request);
         await refreshData(selectedTransfer.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveTransfer"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleCancelTransfer() {
      if (selectedTransfer === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         await cancelTransfer(selectedTransfer.id);
         await refreshData(selectedTransfer.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveTransfer"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell active="transfers" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.transfer") }]} />}>
         <div className="sites-page">
            <PageHeader title={t("transfer.title")} actions={<div className="page-actions"><Button variant="primary" onClick={() => { setSelectedId(""); setCreateToken((current) => current + 1); }}>{t("transfer.newOrder")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className="site-workbench">
               <section className="card site-registry">
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("transfer.registry")}</h2><p className="section-subtitle">{t("transfer.registryDesc")}</p></div><Badge tone="role">{isLoading ? t("transfer.loadingState") : `${visibleTransfers.length} ${t("common.records")}`}</Badge></div>
                     <div className="section-toolbar"><select className="field-input" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">{t("transfer.allSites")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><select className="field-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{t("transfer.allStatuses")}</option>{TRANSFER_STATUSES.map((status) => <option key={status} value={status}>{t(`transfer.status.${status}`)}</option>)}</select></div>
                     {isLoading ? <EmptyState icon="…" title={t("transfer.loading")} description={t("transfer.fetching")} /> : visibleTransfers.length === 0 ? <EmptyState icon="0" title={t("transfer.emptyTitle")} description={t("transfer.emptyDesc")} /> : <TransferOrderTable rows={visibleTransfers} selectedId={selectedId} sites={sites} storageLocations={storageLocations} onSelect={(id) => { void handleSelectTransfer(id); }} />}
                  </div>
               </section>
               <aside className="card site-editor">
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("transfer.editor")}</h2><p className="section-subtitle">{t("transfer.editorDesc")}</p></div></div>
                     {selectedTransfer === null ? (
                        <TransferOrderForm key={`transfer-${createToken}`} initialValues={formValues} isSaving={isSaving} inventoryBalances={inventoryBalances} products={products} sites={sites} storageLocations={storageLocations} onSubmit={handleCreateTransfer} />
                     ) : (
                        <TransferDetail key={selectedTransfer.id} transfer={selectedTransfer} inventoryBalances={inventoryBalances} isSaving={isSaving} products={products} sites={sites} storageLocations={storageLocations} onApprove={handleApproveTransfer} onShip={handleShipTransfer} onReceive={handleReceiveTransfer} onCancel={handleCancelTransfer} />
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
