import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import {
   activateRecall,
   closeRecall,
   createRecall,
   loadInventoryBalances,
   loadRecalls,
   loadSites,
   updateRecallAffectedBatch,
   type InventoryBalanceDto,
   type RecallCaseDto,
   type SiteDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./RecallPage.module.css";

type RecallForm = {
   recallNumber: string;
   title: string;
   reason: string;
   productBatchId: string;
   siteId: string;
   notes: string;
};

const defaultForm: RecallForm = {
   recallNumber: "",
   title: "",
   reason: "",
   productBatchId: "",
   siteId: "",
   notes: "",
};

function formatDate(value: string | null) {
   return value === null ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function siteName(sites: SiteDto[], siteId: string | null) {
   if (siteId === null) return "All sites";
   return sites.find((site) => site.id === siteId)?.name ?? siteId;
}

function statusTone(status: string) {
   if (status === "Active" || status === "Quarantined") return "warn" as const;
   if (status === "Closed" || status === "Released") return "ok" as const;
   if (status === "Cancelled" || status === "Destroyed" || status === "Removed") return "bad" as const;
   return "role" as const;
}

export default function RecallPage() {
   const t = useT();
   const [recalls, setRecalls] = useState<RecallCaseDto[]>([]);
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [form, setForm] = useState<RecallForm>(defaultForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [successMessage, setSuccessMessage] = useState<string | null>(null);

   const batchOptions = useMemo(() => {
      const seen = new Set<string>();
      return balances.filter((balance) => {
         if (seen.has(balance.productBatchId)) return false;
         seen.add(balance.productBatchId);
         return balance.quantityOnHand > 0;
      });
   }, [balances]);

   const selectedBalance = balances.find(
      (balance) => balance.productBatchId === form.productBatchId && (form.siteId === "" || balance.siteId === form.siteId),
   );

   async function refresh() {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [nextRecalls, nextBalances, nextSites] = await Promise.all([
            loadRecalls({ limit: 100 }),
            loadInventoryBalances({ includeZeroBalances: false }),
            loadSites(),
         ]);
         setRecalls(nextRecalls);
         setBalances(nextBalances);
         setSites(nextSites);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadRecalls"));
      } finally {
         setIsLoading(false);
      }
   }

   useMountEffect(() => {
      void refresh();
   });

   async function handleCreateRecall() {
      setIsSubmitting(true);
      setBannerError(null);
      setSuccessMessage(null);
      try {
         const created = await createRecall({
            recallNumber: form.recallNumber,
            title: form.title,
            reason: form.reason,
            notes: form.notes === "" ? null : form.notes,
            affectedBatches: [{ productBatchId: form.productBatchId, siteId: form.siteId === "" ? null : form.siteId, notes: form.notes === "" ? null : form.notes }],
         });
         await activateRecall(created.id, form.notes);
         setForm(defaultForm);
         setSuccessMessage(t("recalls.created"));
         await refresh();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.saveRecall"));
      } finally {
         setIsSubmitting(false);
      }
   }

   async function handleCloseRecall(id: string) {
      await closeRecall(id);
      await refresh();
   }

   async function handleBatchAction(recallId: string, affectedBatchId: string, status: string) {
      await updateRecallAffectedBatch(recallId, affectedBatchId, status);
      await refresh();
   }

   return (
      <AppShell
         active="recalls"
         breadcrumb={<Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.recalls") }]} />}
      >
         <div className={`${styles.reportingPage} ${styles.recallPage}`}>
            <PageHeader title={t("recalls.title")} description={t("recalls.description")} actions={<Button onClick={() => void refresh()}>{t("common.refresh")}</Button>} />

            {bannerError !== null ? <div className="form-banner error">{bannerError}</div> : null}
            {successMessage !== null ? <div className="form-banner success">{successMessage}</div> : null}

            <section className={`card section ${styles.recallFormCard}`}>
               <div className="section-head">
                  <div>
                     <h2>{t("recalls.newTitle")}</h2>
                     <p>{t("recalls.newDescription")}</p>
                  </div>
               </div>
               <div className="form-grid three">
                  <Field label={t("recalls.number")}>
                     <input value={form.recallNumber} onChange={(event) => setForm((current) => ({ ...current, recallNumber: event.target.value }))} />
                  </Field>
                  <Field label={t("recalls.caseTitle")}>
                     <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
                  </Field>
                  <Field label={t("recalls.batch")}>
                     <select value={form.productBatchId} onChange={(event) => setForm((current) => ({ ...current, productBatchId: event.target.value }))}>
                        <option value="">{t("recalls.selectBatch")}</option>
                        {batchOptions.map((balance) => (
                           <option key={balance.productBatchId} value={balance.productBatchId}>
                              {balance.productName} · {balance.batchNumber} · {balance.expiryDate}
                           </option>
                        ))}
                     </select>
                  </Field>
                  <Field label={t("recalls.siteScope")}>
                     <select value={form.siteId} onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}>
                        <option value="">{t("recalls.allSites")}</option>
                        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                     </select>
                  </Field>
                  <Field label={t("recalls.reason")}>
                     <input value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
                  </Field>
                  <Field label={t("recalls.notes")}>
                     <input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
                  </Field>
               </div>
               {selectedBalance !== undefined ? <p className="muted">{selectedBalance.productName} · {selectedBalance.batchNumber} · {siteName(sites, selectedBalance.siteId)} · {selectedBalance.quantityOnHand}</p> : null}
               <div className="form-actions">
                  <Button variant="primary" disabled={isSubmitting || form.recallNumber === "" || form.title === "" || form.reason === "" || form.productBatchId === ""} onClick={() => void handleCreateRecall()}>
                     {isSubmitting ? t("common.saving") : t("recalls.create")}
                  </Button>
               </div>
            </section>

            <section className="card section">
               <div className="section-head">
                  <div>
                     <h2>{t("recalls.listTitle")}</h2>
                     <p>{t("recalls.listDescription")}</p>
                  </div>
               </div>
               {isLoading ? <p>{t("common.loading")}</p> : recalls.length === 0 ? <EmptyState icon={<AlertTriangle size={20} />} title={t("recalls.emptyTitle")} description={t("recalls.emptyDescription")} /> : (
                  <div className={styles.recallList}>
                     {recalls.map((recall) => (
                        <article key={recall.id} className={styles.recallCard}>
                           <div className={styles.recallCardHead}>
                              <div>
                                 <h3>{recall.recallNumber} · {recall.title}</h3>
                                 <p>{recall.reason}</p>
                              </div>
                              <Badge tone={statusTone(recall.status)}>{recall.status}</Badge>
                           </div>
                           <p className="muted">{t("recalls.createdAt")}: {formatDate(recall.createdAtUtc)} · {t("recalls.activatedAt")}: {formatDate(recall.activatedAtUtc)}</p>
                           <div className="table-wrap">
                              <table>
                                 <thead><tr><th>{t("recalls.batch")}</th><th>{t("recalls.siteScope")}</th><th>{t("recalls.status")}</th><th>{t("common.actions")}</th></tr></thead>
                                 <tbody>
                                    {recall.affectedBatches.map((batch) => (
                                       <tr key={batch.id}>
                                          <td><strong>{batch.productName}</strong><br /><span>{batch.batchNumber} · {batch.expiryDate}</span></td>
                                          <td>{siteName(sites, batch.siteId)}</td>
                                          <td><Badge tone={statusTone(batch.status)}>{batch.status}</Badge></td>
                                          <td>
                                             <div className="inline-actions">
                                                <Button size="sm" onClick={() => void handleBatchAction(recall.id, batch.id, "Quarantined")}>{t("recalls.quarantine")}</Button>
                                                <Button size="sm" onClick={() => void handleBatchAction(recall.id, batch.id, "Destroyed")}>{t("recalls.destroy")}</Button>
                                                <Button size="sm" onClick={() => void handleBatchAction(recall.id, batch.id, "Released")}>{t("recalls.release")}</Button>
                                             </div>
                                          </td>
                                       </tr>
                                    ))}
                                 </tbody>
                              </table>
                           </div>
                           {recall.status === "Active" ? <Button onClick={() => void handleCloseRecall(recall.id)}>{t("recalls.close")}</Button> : null}
                        </article>
                     ))}
                  </div>
               )}
            </section>
         </div>
      </AppShell>
   );
}
