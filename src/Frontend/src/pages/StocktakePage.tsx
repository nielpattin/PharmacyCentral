import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { createStocktakeSession, loadProducts, loadSites, loadStockAdjustments, loadStocktakeSessions, loadStorageLocations, postStocktakeAdjustments, recordStocktakeCount, type ProductDto, type SiteDto, type StockAdjustmentDetails, type StocktakeCountRequest, type StocktakeSessionCreateRequest, type StocktakeSessionDetails, type StorageLocationDto } from "../api/pharmacyClient";
import { CountSheetTable } from "../features/stocktakes/CountSheetTable";
import { StockAdjustmentTable } from "../features/stocktakes/StockAdjustmentTable";
import { StocktakeSessionForm } from "../features/stocktakes/StocktakeSessionForm";
import { StocktakeSessionTable } from "../features/stocktakes/StocktakeSessionTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./StocktakePage.module.css";
import { blankStocktakeSessionValues, type CountSheetFormValues, type StocktakeSessionFormValues } from "./shared/stocktakeForms";

function stocktakeStatusTone(status: string) {
   if (status === "Completed") return "ok";
   if (status === "Cancelled") return "bad";
   return "warn";
}

export default function StocktakePage() {
   const t = useT();
   const [sessions, setSessions] = useState<StocktakeSessionDetails[]>([]);
   const [adjustments, setAdjustments] = useState<StockAdjustmentDetails[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [selectedId, setSelectedId] = useState("");
   const [siteFilter, setSiteFilter] = useState("");
   const [statusFilter, setStatusFilter] = useState("");
   const [createToken, setCreateToken] = useState(0);

   const selectedSession = useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [sessions, selectedId]);
   const visibleSessions = useMemo(() => sessions.filter((session) => (siteFilter === "" || session.siteId === siteFilter) && (statusFilter === "" || session.status === statusFilter)), [sessions, siteFilter, statusFilter]);
   const selectedAdjustments = useMemo(() => selectedSession === null ? [] : adjustments.filter((adjustment) => adjustment.stocktakeSessionId === selectedSession.id), [adjustments, selectedSession]);
   const hasVariance = selectedSession?.countSheetLines.some((line) => line.variance !== 0) ?? false;
   const formValues = blankStocktakeSessionValues();

   useMountEffect(() => { void refreshData(); });

   async function refreshData(preferredSelectedId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [sessionData, adjustmentData, siteData, locationData, productData] = await Promise.all([loadStocktakeSessions({ limit: 100 }), loadStockAdjustments({ limit: 100 }), loadSites(), loadStorageLocations(), loadProducts()]);
         setSessions(sessionData);
         setAdjustments(adjustmentData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);
         const nextSelectedId = preferredSelectedId ?? selectedId;
         setSelectedId(sessionData.some((session) => session.id === nextSelectedId) ? nextSelectedId : (sessionData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadStocktake"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleCreateSession(values: StocktakeSessionFormValues) {
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: StocktakeSessionCreateRequest = { siteId: values.siteId, storageLocationId: values.storageLocationId, notes: values.notes.trim() || null };
         const result = await createStocktakeSession(request);
         await refreshData(result.id);
         setCreateToken((current) => current + 1);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveStocktake"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleRecordCount(values: CountSheetFormValues) {
      if (selectedSession === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const request: StocktakeCountRequest = { countSheetLines: values.countSheetLines.map((line) => ({ productId: line.productId, productBatchId: line.productBatchId, countedQuantity: Number(line.countedQuantity), notes: line.notes.trim() || null })) };
         await recordStocktakeCount(selectedSession.id, request);
         await refreshData(selectedSession.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveStocktake"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handlePostAdjustments() {
      if (selectedSession === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         await postStocktakeAdjustments(selectedSession.id);
         await refreshData(selectedSession.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveStocktake"));
      } finally {
         setIsSaving(false);
      }
   }

   const siteName = (id: string) => sites.find((site) => site.id === id)?.name ?? id;
   const locationName = (id: string) => storageLocations.find((location) => location.id === id)?.name ?? id;

   return (
      <AppShell active="stocktake" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.stocktake") }]} />}>
         <div className={styles.sitesPage}>
            <PageHeader title={t("stocktake.title")} actions={<div className="page-actions"><Button variant="primary" onClick={() => { setSelectedId(""); setCreateToken((current) => current + 1); }}>{t("stocktake.newSession")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            <div className={styles.siteWorkbench}>
               <section className={`card ${styles.siteRegistry}`}>
                  <div className="section">
                     <div className="section-header"><div><h2 className="section-title">{t("stocktake.registry")}</h2><p className="section-subtitle">{t("stocktake.registryDesc")}</p></div><Badge tone="role">{isLoading ? t("stocktake.loadingState") : `${visibleSessions.length} ${t("common.records")}`}</Badge></div>
                     <div className="section-toolbar"><select className="field-input" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="">{t("stocktake.allSites")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select><select className="field-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{t("stocktake.allStatuses")}</option>{["Draft", "InProgress", "Completed", "Cancelled"].map((status) => <option key={status} value={status}>{t(`stocktake.status.${status}`)}</option>)}</select></div>
                     {isLoading ? <EmptyState icon="…" title={t("stocktake.loading")} description={t("stocktake.fetching")} /> : visibleSessions.length === 0 ? <EmptyState icon="0" title={t("stocktake.emptyTitle")} description={t("stocktake.emptyDesc")} /> : <StocktakeSessionTable rows={visibleSessions} selectedId={selectedId} sites={sites} storageLocations={storageLocations} onSelect={setSelectedId} />}
                  </div>
               </section>
               <aside className={`card ${styles.siteEditor}`}>
                  <div className="section">
                     <div className="section-header">
                        <div><h2 className="section-title">{t("stocktake.editor")}</h2><p className="section-subtitle">{t("stocktake.editorDesc")}</p></div>
                     </div>
                     {selectedSession === null ? (
                        <StocktakeSessionForm key={`stocktake-${createToken}`} initialValues={formValues} isSaving={isSaving} sites={sites} storageLocations={storageLocations} mode="create" onSubmit={handleCreateSession} />
                     ) : (
                        <div className="entity-form">
                           <div className="section-header">
                              <div><h3 className="section-title">{siteName(selectedSession.siteId)} · {locationName(selectedSession.storageLocationId)}</h3><p className="section-subtitle">{new Date(selectedSession.startedAtUtc).toLocaleString()}</p></div>
                              <Badge tone={stocktakeStatusTone(selectedSession.status)}>{t(`stocktake.status.${selectedSession.status}`)}</Badge>
                           </div>
                           <CountSheetTable key={selectedSession.id} session={selectedSession} products={products} isSaving={isSaving} onSubmit={handleRecordCount} />
                           <div className="form-actions"><Button variant="primary" onClick={handlePostAdjustments} disabled={isSaving || !hasVariance}>{t("stocktake.postAdjustments")}</Button></div>
                           <div className="section-header"><div><h3 className="section-title">{t("stocktake.adjustments")}</h3><p className="section-subtitle">{t("stocktake.adjustmentsDesc")}</p></div></div>
                           {selectedAdjustments.length === 0 ? <EmptyState icon="0" title={t("stocktake.noAdjustments")} description={t("stocktake.noAdjustmentsDesc")} /> : <StockAdjustmentTable rows={selectedAdjustments} products={products} sites={sites} storageLocations={storageLocations} />}
                        </div>
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
