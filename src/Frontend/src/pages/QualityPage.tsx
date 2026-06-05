import { ClipboardCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import {
   loadInventoryBalances,
   loadSites,
   loadStorageLocations,
   rejectProductBatch,
   releaseProductBatch,
   type InventoryBalanceDto,
   type SiteDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";

type ReviewForm = {
   batchId: string;
   notes: string;
};

const defaultReviewForm: ReviewForm = {
   batchId: "",
   notes: "",
};

function formatQuantity(value: number) {
   return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function siteName(sites: SiteDto[], siteId: string) {
   return sites.find((site) => site.id === siteId)?.name ?? siteId;
}

function locationName(locations: StorageLocationDto[], locationId: string) {
   return locations.find((location) => location.id === locationId)?.name ?? locationId;
}

function statusTone(status: string) {
   if (status === "Released") {
      return "ok" as const;
   }

   if (status === "Rejected") {
      return "bad" as const;
   }

   return "warn" as const;
}

export default function QualityPage() {
   const t = useT();
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [locations, setLocations] = useState<StorageLocationDto[]>([]);
   const [form, setForm] = useState<ReviewForm>(defaultReviewForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [successMessage, setSuccessMessage] = useState<string | null>(null);

   const reviewBalances = useMemo(() => {
      return balances
         .filter((balance) => balance.quantityOnHand > 0 && balance.qualityStatus !== "Released")
         .sort((a, b) => a.productName.localeCompare(b.productName) || a.batchNumber.localeCompare(b.batchNumber));
   }, [balances]);

   const selectedBalance = reviewBalances.find((balance) => balance.productBatchId === form.batchId) ?? null;

   async function loadPageData() {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [nextBalances, nextSites, nextLocations] = await Promise.all([
            loadInventoryBalances({ includeZeroBalances: false }),
            loadSites(),
            loadStorageLocations(),
         ]);
         setBalances(nextBalances);
         setSites(nextSites);
         setLocations(nextLocations);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadInventoryBalances"));
      } finally {
         setIsLoading(false);
      }
   }

   useMountEffect(() => {
      void loadPageData();
   });

   async function submitDecision(decision: "release" | "reject") {
      if (form.batchId === "") {
         setBannerError(t("quality.validation.batchRequired"));
         return;
      }

      setIsSubmitting(true);
      setBannerError(null);
      setSuccessMessage(null);
      try {
         if (decision === "release") {
            await releaseProductBatch(form.batchId, form.notes.trim() === "" ? undefined : form.notes.trim());
            setSuccessMessage(t("quality.releaseSuccess"));
         } else {
            await rejectProductBatch(form.batchId, form.notes.trim() === "" ? undefined : form.notes.trim());
            setSuccessMessage(t("quality.rejectSuccess"));
         }

         setForm(defaultReviewForm);
         await loadPageData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("quality.reviewFailed"));
      } finally {
         setIsSubmitting(false);
      }
   }

   return (
      <AppShell
         active="quality"
         breadcrumb={<Breadcrumbs items={[{ label: t("nav.dashboard"), href: "/dashboard" }, { label: t("nav.quality") }]} />}
      >
         <main className="quality-page stack-page">
            <PageHeader
               title={t("quality.title")}
               description={t("quality.description")}
               actions={<Button onClick={() => void loadPageData()}>{t("common.refresh")}</Button>}
            />

            {bannerError !== null ? <div className="form-banner error">{bannerError}</div> : null}
            {successMessage !== null ? <div className="form-banner success">{successMessage}</div> : null}

            <section className="card section">
               <div className="section-heading">
                  <div>
                     <h2>{t("quality.pendingTitle")}</h2>
                     <p>{t("quality.pendingSubtitle")}</p>
                  </div>
                  <Badge tone={reviewBalances.length === 0 ? "ok" : "warn"}>{reviewBalances.length}</Badge>
               </div>

               {isLoading ? (
                  <p>{t("common.loading")}</p>
               ) : reviewBalances.length === 0 ? (
                  <EmptyState icon={<ClipboardCheck size={24} />} title={t("quality.emptyTitle")} description={t("quality.emptyDescription")} />
               ) : (
                  <div className="table-wrap">
                     <table>
                        <thead>
                           <tr>
                              <th>{t("quality.product")}</th>
                              <th>{t("quality.batch")}</th>
                              <th>{t("quality.location")}</th>
                              <th>{t("quality.quantity")}</th>
                              <th>{t("quality.status")}</th>
                              <th>{t("common.actions")}</th>
                           </tr>
                        </thead>
                        <tbody>
                           {reviewBalances.map((balance) => (
                              <tr key={`${balance.productBatchId}-${balance.storageLocationId}`}>
                                 <td>
                                    <strong>{balance.productName}</strong>
                                    <span className="muted block">{balance.productSku}</span>
                                 </td>
                                 <td>
                                    <strong>{balance.batchNumber}</strong>
                                    <span className="muted block">{balance.expiryDate}</span>
                                 </td>
                                 <td>
                                    {siteName(sites, balance.siteId)}
                                    <span className="muted block">{locationName(locations, balance.storageLocationId)}</span>
                                 </td>
                                 <td>{formatQuantity(balance.quantityOnHand)}</td>
                                 <td>
                                    <Badge tone={statusTone(balance.qualityStatus)}>{t(`quality.status.${balance.qualityStatus}`)}</Badge>
                                 </td>
                                 <td>
                                    <Button size="sm" variant="secondary" onClick={() => setForm({ ...form, batchId: balance.productBatchId })}>
                                       {t("quality.select")}
                                    </Button>
                                 </td>
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               )}
            </section>

            <section className="card section quality-review-card">
               <div className="section-heading">
                  <div>
                     <h2>{t("quality.reviewTitle")}</h2>
                     <p>{t("quality.reviewSubtitle")}</p>
                  </div>
               </div>

               <div className="form-grid two-columns">
                  <Field label={t("quality.selectedBatch")}>
                     <select value={form.batchId} onChange={(event) => setForm({ ...form, batchId: event.target.value })}>
                        <option value="">{t("quality.selectBatch")}</option>
                        {reviewBalances.map((balance) => (
                           <option key={balance.productBatchId} value={balance.productBatchId}>
                              {balance.productName} · {balance.batchNumber} · {siteName(sites, balance.siteId)}
                           </option>
                        ))}
                     </select>
                  </Field>

                  <Field label={t("quality.notes")}>
                     <textarea value={form.notes} rows={3} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
                  </Field>
               </div>

               {selectedBalance !== null ? (
                  <div className="quality-context">
                     <strong>{selectedBalance.productName}</strong>
                     <span>{selectedBalance.batchNumber}</span>
                     <span>{siteName(sites, selectedBalance.siteId)}</span>
                     <span>{formatQuantity(selectedBalance.quantityOnHand)}</span>
                  </div>
               ) : null}

               <div className="form-actions">
                  <Button variant="primary" disabled={isSubmitting} onClick={() => void submitDecision("release")}>
                     {isSubmitting ? t("common.saving") : t("quality.release")}
                  </Button>
                  <Button variant="danger" disabled={isSubmitting} onClick={() => void submitDecision("reject")}>
                     {isSubmitting ? t("common.saving") : t("quality.reject")}
                  </Button>
               </div>
            </section>
         </main>
      </AppShell>
   );
}
