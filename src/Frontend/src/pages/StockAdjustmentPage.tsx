import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
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
import styles from "./StockAdjustmentPage.module.css";

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
   if (status === "Approved") return "secondary";
   if (status === "Rejected") return "destructive";
   return "outline";
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

   const selectedBalance = useMemo(
      () => balances.find((balance) => balance.id === formValues.balanceId) ?? null,
      [balances, formValues.balanceId],
   );
   const selectedAdjustment = useMemo(
      () => adjustments.find((adjustment) => adjustment.id === selectedId) ?? null,
      [adjustments, selectedId],
   );
   const pendingCount = useMemo(
      () => adjustments.filter((adjustment) => adjustment.status === "Pending").length,
      [adjustments],
   );

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

         const nextSelectedId = adjustmentData.some((adjustment) => adjustment.id === preferredSelectedId)
            ? preferredSelectedId
            : (adjustmentData[0]?.id ?? "");
         setSelectedId(nextSelectedId);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("adjustments.errors.load"));
      } finally {
         setIsLoading(false);
      }
   }

   function productName(productId: string) {
      return products.find((product) => product.id === productId)?.name ?? "—";
   }

   function siteName(siteId: string) {
      return sites.find((site) => site.id === siteId)?.name ?? "—";
   }

   function storageLocationName(storageLocationId: string) {
      return storageLocations.find((location) => location.id === storageLocationId)?.name ?? "—";
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
      <AppShell
         active="adjustments"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.adjustments") }]} />
         }
      >
         <div className={styles.adjustmentsPage}>
            <PageHeader
               title={t("adjustments.title")}
               actions={
                  <div className="page-actions">
                     <Button variant="outline" onClick={() => void refreshData()}>
                        {t("common.refresh")}
                     </Button>
                  </div>
               }
            />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}
            {successMessage !== null ? <div className="notice success-note">{successMessage}</div> : null}

            <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
               <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                     <div>
                        <h2 className="m-0 text-sm font-semibold text-foreground">{t("adjustments.createTitle")}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t("adjustments.createDesc")}</p>
                     </div>
                  </div>
                  <div className="form-grid">
                     <Field label={t("adjustments.balance")} required>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={formValues.balanceId}
                           onChange={(event) => updateForm({ ...formValues, balanceId: event.target.value })}
                        >
                           <option value="">{t("adjustments.selectBalance")}</option>
                           {balances.map((balance) => (
                              <option key={balance.id} value={balance.id}>
                                 {balanceLabel(balance)}
                              </option>
                           ))}
                        </select>
                     </Field>
                     <Field label={t("adjustments.type")} required>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={formValues.adjustmentType}
                           onChange={(event) =>
                              updateForm({
                                 ...formValues,
                                 adjustmentType: event.target.value as "Positive" | "Negative",
                              })
                           }
                        >
                           <option value="Positive">{t("adjustments.type.Positive")}</option>
                           <option value="Negative">{t("adjustments.type.Negative")}</option>
                        </select>
                     </Field>
                     <Field label={t("adjustments.quantity")} required>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           type="number"
                           min="0"
                           step="0.01"
                           value={formValues.quantity}
                           onChange={(event) => updateForm({ ...formValues, quantity: event.target.value })}
                        />
                     </Field>
                     <Field label={t("adjustments.reason")} required>
                        <input
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={formValues.reason}
                           onChange={(event) => updateForm({ ...formValues, reason: event.target.value })}
                           maxLength={200}
                        />
                     </Field>
                     <Field label={t("adjustments.notes")}>
                        <textarea
                           className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                           value={formValues.notes}
                           onChange={(event) => updateForm({ ...formValues, notes: event.target.value })}
                           maxLength={1000}
                        />
                     </Field>
                  </div>

                  {selectedBalance !== null ? (
                     <div className={styles.adjustmentsStockContext}>
                        <div>
                           <span>{t("adjustments.product")}</span>
                           <strong>
                              {selectedBalance.productSku} · {selectedBalance.productName}
                           </strong>
                        </div>
                        <div>
                           <span>{t("adjustments.batch")}</span>
                           <strong>{selectedBalance.batchNumber}</strong>
                        </div>
                        <div>
                           <span>{t("adjustments.site")}</span>
                           <strong>{siteName(selectedBalance.siteId)}</strong>
                        </div>
                        <div>
                           <span>{t("adjustments.location")}</span>
                           <strong>{storageLocationName(selectedBalance.storageLocationId)}</strong>
                        </div>
                        <div>
                           <span>{t("adjustments.currentQuantity")}</span>
                           <strong>{selectedBalance.quantityOnHand}</strong>
                        </div>
                     </div>
                  ) : null}

                  <div className="flex flex-wrap justify-end gap-2">
                     <Button onClick={() => void handleCreateAdjustment()} disabled={isSaving}>
                        {isSaving ? t("common.saving") : t("adjustments.createButton")}
                     </Button>
                     <Button variant="outline" onClick={() => setFormValues(defaultFormValues)} disabled={isSaving}>
                        {t("common.reset")}
                     </Button>
                  </div>
               </div>
            </section>

            <div className={styles.adjustmentsGrid}>
               <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("adjustments.reviewTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("adjustments.reviewDesc")}</p>
                        </div>
                        <Badge variant={pendingCount > 0 ? "outline" : "secondary"}>
                           {pendingCount} {t("adjustments.pending")}
                        </Badge>
                     </div>
                     <div className={`flex flex-wrap items-center gap-2 ${styles.adjustmentsToolbar}`}>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.siteId}
                           onChange={(event) => updateFilters({ ...filters, siteId: event.target.value })}
                        >
                           <option value="">{t("adjustments.allSites")}</option>
                           {sites.map((site) => (
                              <option key={site.id} value={site.id}>
                                 {site.name}
                              </option>
                           ))}
                        </select>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={filters.status}
                           onChange={(event) => updateFilters({ ...filters, status: event.target.value })}
                        >
                           <option value="">{t("adjustments.allStatuses")}</option>
                           {["Pending", "Approved", "Rejected"].map((status) => (
                              <option key={status} value={status}>
                                 {t(`adjustments.status.${status}`)}
                              </option>
                           ))}
                        </select>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={String(filters.limit)}
                           onChange={(event) => updateFilters({ ...filters, limit: Number(event.target.value) })}
                        >
                           {[25, 50, 100, 200].map((limit) => (
                              <option key={limit} value={limit}>
                                 {limit}
                              </option>
                           ))}
                        </select>
                        <Button variant="outline" onClick={resetFilters}>
                           {t("adjustments.clearFilters")}
                        </Button>
                     </div>
                     {isLoading ? (
                        <EmptyState icon="…" title={t("adjustments.loading")} description={t("adjustments.fetching")} />
                     ) : adjustments.length === 0 ? (
                        <EmptyState
                           icon="0"
                           title={t("adjustments.emptyTitle")}
                           description={t("adjustments.emptyDesc")}
                        />
                     ) : (
                        <div className="overflow-x-auto">
                           <table className={`w-full border-collapse text-sm ${styles.adjustmentsTable}`}>
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
                                    <tr
                                       key={adjustment.id}
                                       className={adjustment.id === selectedId ? "selected" : undefined}
                                    >
                                       <td>
                                          <strong>{productName(adjustment.productId)}</strong>
                                          <span className={styles.tableMuted}>
                                             {t("adjustments.createdAt", {
                                                value: formatDateTime(adjustment.createdAtUtc),
                                             })}
                                          </span>
                                       </td>
                                       <td>
                                          <strong>{siteName(adjustment.siteId)}</strong>
                                          <span className={styles.tableMuted}>
                                             {storageLocationName(adjustment.storageLocationId)}
                                          </span>
                                       </td>
                                       <td>{t(`adjustments.type.${adjustment.adjustmentType}`)}</td>
                                       <td>{adjustment.quantity}</td>
                                       <td>
                                          <Badge variant={adjustmentStatusTone(adjustment.status)}>
                                             {t(`adjustments.status.${adjustment.status}`)}
                                          </Badge>
                                       </td>
                                       <td>
                                          <Button
                                             size="sm"
                                             variant="outline"
                                             onClick={() => setSelectedId(adjustment.id)}
                                          >
                                             {t("adjustments.review")}
                                          </Button>
                                       </td>
                                    </tr>
                                 ))}
                              </tbody>
                           </table>
                        </div>
                     )}
                  </div>
               </section>

               <aside className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("adjustments.detailTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("adjustments.detailDesc")}</p>
                        </div>
                     </div>
                     {selectedAdjustment === null ? (
                        <EmptyState
                           icon="?"
                           title={t("adjustments.noSelectionTitle")}
                           description={t("adjustments.noSelectionDesc")}
                        />
                     ) : (
                        <div className={`grid gap-3 ${styles.adjustmentsDetail}`}>
                           <div className="flex items-start justify-between gap-3">
                              <div>
                                 <h3 className="m-0 text-sm font-semibold text-foreground">
                                    {productName(selectedAdjustment.productId)}
                                 </h3>
                                 <p className="mt-1 text-sm text-muted-foreground">
                                    {siteName(selectedAdjustment.siteId)} ·{" "}
                                    {storageLocationName(selectedAdjustment.storageLocationId)}
                                 </p>
                              </div>
                              <Badge variant={adjustmentStatusTone(selectedAdjustment.status)}>
                                 {t(`adjustments.status.${selectedAdjustment.status}`)}
                              </Badge>
                           </div>
                           <div className={styles.adjustmentsDetailGrid}>
                              <div>
                                 <span>{t("adjustments.type")}</span>
                                 <strong>{t(`adjustments.type.${selectedAdjustment.adjustmentType}`)}</strong>
                              </div>
                              <div>
                                 <span>{t("adjustments.quantity")}</span>
                                 <strong>{selectedAdjustment.quantity}</strong>
                              </div>
                              <div>
                                 <span>{t("adjustments.createdBy")}</span>
                                 <strong>
                                    {accountReference(selectedAdjustment.createdByUserId) ??
                                       t("adjustments.notRecorded")}
                                 </strong>
                              </div>
                              <div>
                                 <span>{t("adjustments.approvedBy")}</span>
                                 <strong>
                                    {accountReference(selectedAdjustment.approvedByUserId) ??
                                       t("adjustments.notApproved")}
                                 </strong>
                              </div>
                              <div>
                                 <span>{t("adjustments.createdOn")}</span>
                                 <strong>{formatDateTime(selectedAdjustment.createdAtUtc)}</strong>
                              </div>
                              <div>
                                 <span>{t("adjustments.approvedOn")}</span>
                                 <strong>
                                    {formatDateTime(selectedAdjustment.approvedAtUtc) || t("adjustments.notApproved")}
                                 </strong>
                              </div>
                           </div>
                           <div className={styles.adjustmentsNoteBlock}>
                              <span>{t("adjustments.reason")}</span>
                              <p>{selectedAdjustment.reason}</p>
                           </div>
                           {selectedAdjustment.notes !== null ? (
                              <div className={styles.adjustmentsNoteBlock}>
                                 <span>{t("adjustments.notes")}</span>
                                 <p>{selectedAdjustment.notes}</p>
                              </div>
                           ) : null}
                           {selectedAdjustment.status === "Pending" ? (
                              <>
                                 <Field label={t("adjustments.approvalNotes")}>
                                    <textarea
                                       className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                                       value={approvalNotes}
                                       onChange={(event) => setApprovalNotes(event.target.value)}
                                       maxLength={1000}
                                    />
                                 </Field>
                                 <div className="flex flex-wrap justify-end gap-2">
                                    <Button onClick={() => void handleApproveAdjustment()} disabled={isSaving}>
                                       {isSaving ? t("common.saving") : t("adjustments.approveButton")}
                                    </Button>
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
