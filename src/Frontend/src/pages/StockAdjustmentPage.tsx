import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import {
   approveStockAdjustment,
   createStockAdjustment,
   loadInventoryBalances,
   loadProducts,
   loadSites,
   loadStockAdjustments,
   loadStorageLocations,
   type InventoryBalanceDto,
   type ProductDto,
   type SiteDto,
   type StockAdjustmentCreateRequest,
   type StockAdjustmentDetails,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

type AdjustmentFilters = {
   siteId: string;
   status: string;
   limit: number;
};

type AdjustmentFormValues = {
   balanceId: string;
   adjustmentType: "Positive" | "Negative";
   quantity: string;
   reason: string;
   notes: string;
};

const defaultFilters: AdjustmentFilters = {
   siteId: "",
   status: "Pending",
   limit: 100,
};

const defaultFormValues: AdjustmentFormValues = {
   balanceId: "",
   adjustmentType: "Positive",
   quantity: "",
   reason: "",
   notes: "",
};

function adjustmentStatusTone(status: string) {
   if (status === "Approved") return "ok";
   if (status === "Rejected") return "bad";
   return "warn";
}

function formatDateTime(value: string | null) {
   return value === null ? "" : new Date(value).toLocaleString();
}

function accountReference(value: string | null) {
   if (value === null || value === "") {
      return null;
   }

   return `…${value.slice(-8)}`;
}

export default function StockAdjustmentPage() {
   const t = useT();
   const [adjustments, setAdjustments] = useState<StockAdjustmentDetails[]>([]);
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [filters, setFilters] = useState<AdjustmentFilters>(defaultFilters);
   const [formValues, setFormValues] = useState<AdjustmentFormValues>(defaultFormValues);
   const [approvalNotes, setApprovalNotes] = useState("");
   const [selectedId, setSelectedId] = useState("");
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [successMessage, setSuccessMessage] = useState<string | null>(null);

   const selectedBalance = useMemo(() => balances.find((balance) => balance.id === formValues.balanceId) ?? null, [balances, formValues.balanceId]);
   const selectedAdjustment = useMemo(() => adjustments.find((adjustment) => adjustment.id === selectedId) ?? null, [adjustments, selectedId]);
   const pendingCount = useMemo(() => adjustments.filter((adjustment) => adjustment.status === "Pending").length, [adjustments]);

   useMountEffect(() => {
      void refreshData(defaultFilters);
   });

   async function refreshData(nextFilters = filters, preferredSelectedId = selectedId) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [balanceData, adjustmentData, siteData, locationData, productData] = await Promise.all([
            loadInventoryBalances({ includeZeroBalances: false }),
            loadStockAdjustments({ siteId: nextFilters.siteId, status: nextFilters.status, limit: nextFilters.limit }),
            loadSites(),
            loadStorageLocations(),
            loadProducts(),
         ]);

         setBalances(balanceData);
         setAdjustments(adjustmentData);
         setSites(siteData);
         setStorageLocations(locationData);
         setProducts(productData);

         const nextSelectedId = adjustmentData.some((adjustment) => adjustment.id === preferredSelectedId) ? preferredSelectedId : (adjustmentData[0]?.id ?? "");
         setSelectedId(nextSelectedId);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("adjustments.errors.load"));
      } finally {
         setIsLoading(false);
      }
   }

   function productName(productId: string) {
      return products.find((product) => product.id === productId)?.name ?? productId;
   }

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? siteId;
   }

   function storageLocationName(storageLocationId: string) {
      return storageLocations.find((location) => location.id === storageLocationId)?.name ?? storageLocationId;
   }

   function balanceLabel(balance: InventoryBalanceDto) {
      return `${balance.productSku} · ${balance.productName} · ${balance.batchNumber} · ${siteName(balance.siteId)} · ${storageLocationName(balance.storageLocationId)} · ${balance.quantityOnHand}`;
   }

   function updateFilters(nextFilters: AdjustmentFilters) {
      setFilters(nextFilters);
      void refreshData(nextFilters, "");
   }

   function resetFilters() {
      setFilters(defaultFilters);
      void refreshData(defaultFilters, "");
   }

   function updateForm(nextValues: AdjustmentFormValues) {
      setFormValues(nextValues);
      setSuccessMessage(null);
      setBannerError(null);
   }

   async function handleCreateAdjustment() {
      setBannerError(null);
      setSuccessMessage(null);

      if (selectedBalance === null) {
         setBannerError(t("adjustments.validation.balance"));
         return;
      }

      const quantity = Number(formValues.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
         setBannerError(t("adjustments.validation.quantity"));
         return;
      }

      const reason = formValues.reason.trim();
      if (reason.length === 0) {
         setBannerError(t("adjustments.validation.reason"));
         return;
      }

      setIsSaving(true);

      try {
         const request: StockAdjustmentCreateRequest = {
            productId: selectedBalance.productId,
            productBatchId: selectedBalance.productBatchId,
            siteId: selectedBalance.siteId,
            storageLocationId: selectedBalance.storageLocationId,
            adjustmentType: formValues.adjustmentType,
            quantity,
            reason,
            notes: formValues.notes.trim() || null,
         };
         const created = await createStockAdjustment(request);
         const pendingFilters: AdjustmentFilters = { ...filters, status: "Pending" };
         setFilters(pendingFilters);
         setFormValues(defaultFormValues);
         setSuccessMessage(t("adjustments.created"));
         await refreshData(pendingFilters, created.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("adjustments.errors.create"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleApproveAdjustment() {
      if (selectedAdjustment === null || selectedAdjustment.status !== "Pending") {
         return;
      }

      setIsSaving(true);
      setBannerError(null);
      setSuccessMessage(null);

      try {
         const approved = await approveStockAdjustment(selectedAdjustment.id, approvalNotes.trim() || undefined);
         setApprovalNotes("");
         setSuccessMessage(t("adjustments.approved"));
         await refreshData(filters, approved.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("adjustments.errors.approve"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell active="adjustments" breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.adjustments") }]} />}>
         <div className="adjustments-page">
            <PageHeader title={t("adjustments.title")} actions={<div className="page-actions"><Button variant="secondary" onClick={() => void refreshData()}>{t("common.refresh")}</Button></div>} />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            {successMessage !== null ? <div className="notice success-note">{successMessage}</div> : null}

            <section className="card">
               <div className="section">
                  <div className="section-header">
                     <div>
                        <h2 className="section-title">{t("adjustments.createTitle")}</h2>
                        <p className="section-subtitle">{t("adjustments.createDesc")}</p>
                     </div>
                  </div>
                  <div className="form-grid">
                     <Field label={t("adjustments.balance")} required>
                        <select className="field-input" value={formValues.balanceId} onChange={(event) => updateForm({ ...formValues, balanceId: event.target.value })}>
                           <option value="">{t("adjustments.selectBalance")}</option>
                           {balances.map((balance) => <option key={balance.id} value={balance.id}>{balanceLabel(balance)}</option>)}
                        </select>
                     </Field>
                     <Field label={t("adjustments.type")} required>
                        <select className="field-input" value={formValues.adjustmentType} onChange={(event) => updateForm({ ...formValues, adjustmentType: event.target.value as "Positive" | "Negative" })}>
                           <option value="Positive">{t("adjustments.type.Positive")}</option>
                           <option value="Negative">{t("adjustments.type.Negative")}</option>
                        </select>
                     </Field>
                     <Field label={t("adjustments.quantity")} required>
                        <input className="field-input" type="number" min="0" step="0.01" value={formValues.quantity} onChange={(event) => updateForm({ ...formValues, quantity: event.target.value })} />
                     </Field>
                     <Field label={t("adjustments.reason")} required>
                        <input className="field-input" value={formValues.reason} onChange={(event) => updateForm({ ...formValues, reason: event.target.value })} maxLength={200} />
                     </Field>
                     <Field label={t("adjustments.notes")}>
                        <textarea className="field-input textarea" value={formValues.notes} onChange={(event) => updateForm({ ...formValues, notes: event.target.value })} maxLength={1000} />
                     </Field>
                  </div>

                  {selectedBalance !== null ? (
                     <div className="adjustments-stock-context">
                        <div><span>{t("adjustments.product")}</span><strong>{selectedBalance.productSku} · {selectedBalance.productName}</strong></div>
                        <div><span>{t("adjustments.batch")}</span><strong>{selectedBalance.batchNumber}</strong></div>
                        <div><span>{t("adjustments.site")}</span><strong>{siteName(selectedBalance.siteId)}</strong></div>
                        <div><span>{t("adjustments.location")}</span><strong>{storageLocationName(selectedBalance.storageLocationId)}</strong></div>
                        <div><span>{t("adjustments.currentQuantity")}</span><strong>{selectedBalance.quantityOnHand}</strong></div>
                     </div>
                  ) : null}

                  <div className="form-actions">
                     <Button variant="primary" onClick={() => void handleCreateAdjustment()} disabled={isSaving}>{isSaving ? t("common.saving") : t("adjustments.createButton")}</Button>
                     <Button variant="secondary" onClick={() => setFormValues(defaultFormValues)} disabled={isSaving}>{t("common.reset")}</Button>
                  </div>
               </div>
            </section>

            <div className="adjustments-grid">
               <section className="card">
                  <div className="section">
                     <div className="section-header">
                        <div>
                           <h2 className="section-title">{t("adjustments.reviewTitle")}</h2>
                           <p className="section-subtitle">{t("adjustments.reviewDesc")}</p>
                        </div>
                        <Badge tone={pendingCount > 0 ? "warn" : "ok"}>{pendingCount} {t("adjustments.pending")}</Badge>
                     </div>
                     <div className="section-toolbar adjustments-toolbar">
                        <select className="field-input" value={filters.siteId} onChange={(event) => updateFilters({ ...filters, siteId: event.target.value })}>
                           <option value="">{t("adjustments.allSites")}</option>
                           {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                        </select>
                        <select className="field-input" value={filters.status} onChange={(event) => updateFilters({ ...filters, status: event.target.value })}>
                           <option value="">{t("adjustments.allStatuses")}</option>
                           {["Pending", "Approved", "Rejected"].map((status) => <option key={status} value={status}>{t(`adjustments.status.${status}`)}</option>)}
                        </select>
                        <select className="field-input" value={String(filters.limit)} onChange={(event) => updateFilters({ ...filters, limit: Number(event.target.value) })}>
                           {[25, 50, 100, 200].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                        </select>
                        <Button variant="secondary" onClick={resetFilters}>{t("adjustments.clearFilters")}</Button>
                     </div>
                     {isLoading ? <EmptyState icon="…" title={t("adjustments.loading")} description={t("adjustments.fetching")} /> : adjustments.length === 0 ? <EmptyState icon="0" title={t("adjustments.emptyTitle")} description={t("adjustments.emptyDesc")} /> : (
                        <div className="table-wrap">
                           <table className="selectable-table sites-table adjustments-table">
                              <thead>
                                 <tr>
                                    <th>{t("adjustments.product")}</th>
                                    <th>{t("adjustments.place")}</th>
                                    <th>{t("adjustments.type")}</th>
                                    <th>{t("adjustments.quantity")}</th>
                                    <th>{t("adjustments.statusLabel")}</th>
                                    <th>{t("common.actions")}</th>
                                 </tr>
                              </thead>
                              <tbody>
                                 {adjustments.map((adjustment) => (
                                    <tr key={adjustment.id} className={adjustment.id === selectedId ? "selected" : undefined}>
                                       <td><strong>{productName(adjustment.productId)}</strong><span className="table-muted">{t("adjustments.createdAt", { value: formatDateTime(adjustment.createdAtUtc) })}</span></td>
                                       <td><strong>{siteName(adjustment.siteId)}</strong><span className="table-muted">{storageLocationName(adjustment.storageLocationId)}</span></td>
                                       <td>{t(`adjustments.type.${adjustment.adjustmentType}`)}</td>
                                       <td>{adjustment.quantity}</td>
                                       <td><Badge tone={adjustmentStatusTone(adjustment.status)}>{t(`adjustments.status.${adjustment.status}`)}</Badge></td>
                                       <td><Button size="sm" variant="secondary" onClick={() => setSelectedId(adjustment.id)}>{t("adjustments.review")}</Button></td>
                                    </tr>
                                 ))}
                              </tbody>
                           </table>
                        </div>
                     )}
                  </div>
               </section>

               <aside className="card">
                  <div className="section">
                     <div className="section-header">
                        <div>
                           <h2 className="section-title">{t("adjustments.detailTitle")}</h2>
                           <p className="section-subtitle">{t("adjustments.detailDesc")}</p>
                        </div>
                     </div>
                     {selectedAdjustment === null ? (
                        <EmptyState icon="?" title={t("adjustments.noSelectionTitle")} description={t("adjustments.noSelectionDesc")} />
                     ) : (
                        <div className="entity-form adjustments-detail">
                           <div className="section-header">
                              <div>
                                 <h3 className="section-title">{productName(selectedAdjustment.productId)}</h3>
                                 <p className="section-subtitle">{siteName(selectedAdjustment.siteId)} · {storageLocationName(selectedAdjustment.storageLocationId)}</p>
                              </div>
                              <Badge tone={adjustmentStatusTone(selectedAdjustment.status)}>{t(`adjustments.status.${selectedAdjustment.status}`)}</Badge>
                           </div>
                           <div className="adjustments-detail-grid">
                              <div><span>{t("adjustments.type")}</span><strong>{t(`adjustments.type.${selectedAdjustment.adjustmentType}`)}</strong></div>
                              <div><span>{t("adjustments.quantity")}</span><strong>{selectedAdjustment.quantity}</strong></div>
                              <div><span>{t("adjustments.createdBy")}</span><strong>{accountReference(selectedAdjustment.createdByUserId) ?? t("adjustments.notRecorded")}</strong></div>
                              <div><span>{t("adjustments.approvedBy")}</span><strong>{accountReference(selectedAdjustment.approvedByUserId) ?? t("adjustments.notApproved")}</strong></div>
                              <div><span>{t("adjustments.createdOn")}</span><strong>{formatDateTime(selectedAdjustment.createdAtUtc)}</strong></div>
                              <div><span>{t("adjustments.approvedOn")}</span><strong>{formatDateTime(selectedAdjustment.approvedAtUtc) || t("adjustments.notApproved")}</strong></div>
                           </div>
                           <div className="adjustments-note-block">
                              <span>{t("adjustments.reason")}</span>
                              <p>{selectedAdjustment.reason}</p>
                           </div>
                           {selectedAdjustment.notes !== null ? (
                              <div className="adjustments-note-block">
                                 <span>{t("adjustments.notes")}</span>
                                 <p>{selectedAdjustment.notes}</p>
                              </div>
                           ) : null}
                           {selectedAdjustment.status === "Pending" ? (
                              <>
                                 <Field label={t("adjustments.approvalNotes")}>
                                    <textarea className="field-input textarea" value={approvalNotes} onChange={(event) => setApprovalNotes(event.target.value)} maxLength={1000} />
                                 </Field>
                                 <div className="form-actions">
                                    <Button variant="primary" onClick={() => void handleApproveAdjustment()} disabled={isSaving}>{isSaving ? t("common.saving") : t("adjustments.approveButton")}</Button>
                                 </div>
                              </>
                           ) : null}
                        </div>
                     )}
                  </div>
               </aside>
            </div>
         </div>
      </AppShell>
   );
}
