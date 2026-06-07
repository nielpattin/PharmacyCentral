import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/shadcn/card";
import { Input } from "../components/shadcn/input";
import { Label } from "../components/shadcn/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/shadcn/table";
import { Textarea } from "../components/shadcn/textarea";
import { EmptyState } from "../components/ui/EmptyState";
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

function statusVariant(status: string) {
   if (status === "Active" || status === "Quarantined") return "outline" as const;
   if (status === "Closed" || status === "Released") return "secondary" as const;
   if (status === "Cancelled" || status === "Destroyed" || status === "Removed") return "destructive" as const;
   return "default" as const;
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
      (balance) =>
         balance.productBatchId === form.productBatchId && (form.siteId === "" || balance.siteId === form.siteId),
   );
   const siteName = (siteId: string | null) =>
      siteId === null ? t("recalls.allSites") : (sites.find((site) => site.id === siteId)?.name ?? t("common.noData"));

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
            affectedBatches: [
               {
                  productBatchId: form.productBatchId,
                  siteId: form.siteId === "" ? null : form.siteId,
                  notes: form.notes === "" ? null : form.notes,
               },
            ],
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
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.recalls") }]} />
         }
      >
         <div className={styles.page}>
            <PageHeader
               title={t("recalls.title")}
               description={t("recalls.description")}
               actions={
                  <Button variant="outline" onClick={() => void refresh()}>
                     {t("common.refresh")}
                  </Button>
               }
            />

            {bannerError !== null ? <div className="form-banner error">{bannerError}</div> : null}
            {successMessage !== null ? <div className="form-banner success">{successMessage}</div> : null}

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("recalls.newTitle")}</CardTitle>
                     <CardDescription>{t("recalls.newDescription")}</CardDescription>
                  </div>
               </CardHeader>
               <CardContent className={styles.formGrid}>
                  <div className={styles.field}>
                     <Label>{t("recalls.number")}</Label>
                     <Input
                        value={form.recallNumber}
                        onChange={(event) => setForm((current) => ({ ...current, recallNumber: event.target.value }))}
                     />
                  </div>
                  <div className={styles.field}>
                     <Label>{t("recalls.caseTitle")}</Label>
                     <Input
                        value={form.title}
                        onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                     />
                  </div>
                  <div className={styles.field}>
                     <Label>{t("recalls.batch")}</Label>
                     <select
                        className="field-input"
                        value={form.productBatchId}
                        onChange={(event) => setForm((current) => ({ ...current, productBatchId: event.target.value }))}
                     >
                        <option value="">{t("recalls.selectBatch")}</option>
                        {batchOptions.map((balance) => (
                           <option key={balance.productBatchId} value={balance.productBatchId}>
                              {balance.productName} · {balance.batchNumber} · {balance.expiryDate}
                           </option>
                        ))}
                     </select>
                  </div>
                  <div className={styles.field}>
                     <Label>{t("recalls.siteScope")}</Label>
                     <select
                        className="field-input"
                        value={form.siteId}
                        onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
                     >
                        <option value="">{t("recalls.allSites")}</option>
                        {sites.map((site) => (
                           <option key={site.id} value={site.id}>
                              {site.name}
                           </option>
                        ))}
                     </select>
                  </div>
                  <div className={styles.field}>
                     <Label>{t("recalls.reason")}</Label>
                     <Input
                        value={form.reason}
                        onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                     />
                  </div>
                  <div className={styles.field}>
                     <Label>{t("recalls.notes")}</Label>
                     <Textarea
                        value={form.notes}
                        onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                     />
                  </div>
                  {selectedBalance !== undefined ? (
                     <p className={styles.selectedContext}>
                        {selectedBalance.productName} · {selectedBalance.batchNumber} ·{" "}
                        {siteName(selectedBalance.siteId)} · {selectedBalance.quantityOnHand}
                     </p>
                  ) : null}
                  <div className={styles.actions}>
                     <Button
                        disabled={
                           isSubmitting ||
                           form.recallNumber === "" ||
                           form.title === "" ||
                           form.reason === "" ||
                           form.productBatchId === ""
                        }
                        onClick={() => void handleCreateRecall()}
                     >
                        {isSubmitting ? t("common.saving") : t("recalls.create")}
                     </Button>
                  </div>
               </CardContent>
            </Card>

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("recalls.listTitle")}</CardTitle>
                     <CardDescription>{t("recalls.listDescription")}</CardDescription>
                  </div>
               </CardHeader>
               <CardContent className={styles.cardContent}>
                  {isLoading ? (
                     <p>{t("common.loading")}</p>
                  ) : recalls.length === 0 ? (
                     <EmptyState
                        icon={<AlertTriangle size={20} />}
                        title={t("recalls.emptyTitle")}
                        description={t("recalls.emptyDescription")}
                     />
                  ) : (
                     <div className={styles.recallList}>
                        {recalls.map((recall, index) => (
                           <motion.article
                              key={recall.id}
                              layout
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.14, delay: index * 0.02, ease: [0.2, 0, 0, 1] }}
                              className={styles.recallCard}
                           >
                              <div className={styles.recallCardHead}>
                                 <div>
                                    <h3>
                                       {recall.recallNumber} · {recall.title}
                                    </h3>
                                    <p>{recall.reason}</p>
                                 </div>
                                 <Badge variant={statusVariant(recall.status)}>{recall.status}</Badge>
                              </div>
                              <p className={styles.mutedLine}>
                                 {t("recalls.createdAt")}: {formatDate(recall.createdAtUtc)} ·{" "}
                                 {t("recalls.activatedAt")}: {formatDate(recall.activatedAtUtc)}
                              </p>
                              <Table>
                                 <TableHeader>
                                    <TableRow>
                                       <TableHead>{t("recalls.batch")}</TableHead>
                                       <TableHead>{t("recalls.siteScope")}</TableHead>
                                       <TableHead>{t("recalls.status")}</TableHead>
                                       <TableHead>{t("common.actions")}</TableHead>
                                    </TableRow>
                                 </TableHeader>
                                 <TableBody>
                                    {recall.affectedBatches.map((batch) => (
                                       <TableRow key={batch.id}>
                                          <TableCell>
                                             <strong>{batch.productName}</strong>
                                             <br />
                                             <span>
                                                {batch.batchNumber} · {batch.expiryDate}
                                             </span>
                                          </TableCell>
                                          <TableCell>{siteName(batch.siteId)}</TableCell>
                                          <TableCell>
                                             <Badge variant={statusVariant(batch.status)}>{batch.status}</Badge>
                                          </TableCell>
                                          <TableCell>
                                             <div className={styles.inlineActions}>
                                                <Button
                                                   size="sm"
                                                   variant="outline"
                                                   onClick={() =>
                                                      void handleBatchAction(recall.id, batch.id, "Quarantined")
                                                   }
                                                >
                                                   {t("recalls.quarantine")}
                                                </Button>
                                                <Button
                                                   size="sm"
                                                   variant="destructive"
                                                   onClick={() =>
                                                      void handleBatchAction(recall.id, batch.id, "Destroyed")
                                                   }
                                                >
                                                   {t("recalls.destroy")}
                                                </Button>
                                                <Button
                                                   size="sm"
                                                   onClick={() =>
                                                      void handleBatchAction(recall.id, batch.id, "Released")
                                                   }
                                                >
                                                   {t("recalls.release")}
                                                </Button>
                                             </div>
                                          </TableCell>
                                       </TableRow>
                                    ))}
                                 </TableBody>
                              </Table>
                              {recall.status === "Active" ? (
                                 <Button variant="outline" onClick={() => void handleCloseRecall(recall.id)}>
                                    {t("recalls.close")}
                                 </Button>
                              ) : null}
                           </motion.article>
                        ))}
                     </div>
                  )}
               </CardContent>
            </Card>
         </div>
      </AppShell>
   );
}
