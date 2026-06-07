import { ClipboardCheck } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/shadcn/card";
import { Label } from "../components/shadcn/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/shadcn/table";
import { Textarea } from "../components/shadcn/textarea";
import { EmptyState } from "../components/ui/EmptyState";
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
import styles from "./QualityPage.module.css";

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

function statusVariant(status: string) {
   if (status === "Released") return "secondary" as const;
   if (status === "Rejected") return "destructive" as const;
   return "outline" as const;
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
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? t("common.noData");
   const locationName = (locationId: string) =>
      locations.find((location) => location.id === locationId)?.name ?? t("common.noData");

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
         breadcrumb={
            <Breadcrumbs items={[{ label: t("nav.dashboard"), href: "/dashboard" }, { label: t("nav.quality") }]} />
         }
      >
         <main className={styles.page}>
            <PageHeader
               title={t("quality.title")}
               description={t("quality.description")}
               actions={
                  <Button variant="outline" onClick={() => void loadPageData()}>
                     {t("common.refresh")}
                  </Button>
               }
            />

            {bannerError !== null ? <div className="form-banner error">{bannerError}</div> : null}
            {successMessage !== null ? <div className="form-banner success">{successMessage}</div> : null}

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("quality.pendingTitle")}</CardTitle>
                     <CardDescription>{t("quality.pendingSubtitle")}</CardDescription>
                  </div>
                  <Badge variant={reviewBalances.length === 0 ? "secondary" : "outline"}>{reviewBalances.length}</Badge>
               </CardHeader>
               <CardContent className={styles.cardContent}>
                  {isLoading ? (
                     <p>{t("common.loading")}</p>
                  ) : reviewBalances.length === 0 ? (
                     <EmptyState
                        icon={<ClipboardCheck size={24} />}
                        title={t("quality.emptyTitle")}
                        description={t("quality.emptyDescription")}
                     />
                  ) : (
                     <Table className={styles.table}>
                        <TableHeader>
                           <TableRow>
                              <TableHead>{t("quality.product")}</TableHead>
                              <TableHead>{t("quality.batch")}</TableHead>
                              <TableHead>{t("quality.location")}</TableHead>
                              <TableHead>{t("quality.quantity")}</TableHead>
                              <TableHead>{t("quality.status")}</TableHead>
                              <TableHead>{t("common.actions")}</TableHead>
                           </TableRow>
                        </TableHeader>
                        <TableBody>
                           {reviewBalances.map((balance, index) => (
                              <motion.tr
                                 key={`${balance.productBatchId}-${balance.storageLocationId}`}
                                 layout
                                 initial={{ opacity: 0, y: 6 }}
                                 animate={{ opacity: 1, y: 0 }}
                                 transition={{ duration: 0.12, delay: index * 0.01, ease: [0.2, 0, 0, 1] }}
                              >
                                 <TableCell>
                                    <strong>{balance.productName}</strong>
                                    <span className={styles.mutedBlock}>{balance.productSku}</span>
                                 </TableCell>
                                 <TableCell>
                                    <strong>{balance.batchNumber}</strong>
                                    <span className={styles.mutedBlock}>{balance.expiryDate}</span>
                                 </TableCell>
                                 <TableCell>
                                    {siteName(balance.siteId)}
                                    <span className={styles.mutedBlock}>{locationName(balance.storageLocationId)}</span>
                                 </TableCell>
                                 <TableCell>{formatQuantity(balance.quantityOnHand)}</TableCell>
                                 <TableCell>
                                    <Badge variant={statusVariant(balance.qualityStatus)}>
                                       {t(`quality.status.${balance.qualityStatus}`)}
                                    </Badge>
                                 </TableCell>
                                 <TableCell>
                                    <Button
                                       size="sm"
                                       variant="outline"
                                       onClick={() => setForm({ ...form, batchId: balance.productBatchId })}
                                    >
                                       {t("quality.select")}
                                    </Button>
                                 </TableCell>
                              </motion.tr>
                           ))}
                        </TableBody>
                     </Table>
                  )}
               </CardContent>
            </Card>

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("quality.reviewTitle")}</CardTitle>
                     <CardDescription>{t("quality.reviewSubtitle")}</CardDescription>
                  </div>
               </CardHeader>
               <CardContent className={styles.reviewContent}>
                  <div className={styles.formGrid}>
                     <div className={styles.field}>
                        <Label>{t("quality.selectedBatch")}</Label>
                        <select
                           className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                           value={form.batchId}
                           onChange={(event) => setForm({ ...form, batchId: event.target.value })}
                        >
                           <option value="">{t("quality.selectBatch")}</option>
                           {reviewBalances.map((balance) => (
                              <option key={balance.productBatchId} value={balance.productBatchId}>
                                 {balance.productName} · {balance.batchNumber} · {siteName(balance.siteId)}
                              </option>
                           ))}
                        </select>
                     </div>
                     <div className={styles.field}>
                        <Label>{t("quality.notes")}</Label>
                        <Textarea
                           value={form.notes}
                           rows={3}
                           onChange={(event) => setForm({ ...form, notes: event.target.value })}
                        />
                     </div>
                  </div>

                  {selectedBalance !== null ? (
                     <div className={styles.context}>
                        <strong>{selectedBalance.productName}</strong>
                        <span>{selectedBalance.batchNumber}</span>
                        <span>{siteName(selectedBalance.siteId)}</span>
                        <span>{formatQuantity(selectedBalance.quantityOnHand)}</span>
                     </div>
                  ) : null}

                  <div className={styles.actions}>
                     <Button disabled={isSubmitting} onClick={() => void submitDecision("release")}>
                        {isSubmitting ? t("common.saving") : t("quality.release")}
                     </Button>
                     <Button
                        variant="destructive"
                        disabled={isSubmitting}
                        onClick={() => void submitDecision("reject")}
                     >
                        {isSubmitting ? t("common.saving") : t("quality.reject")}
                     </Button>
                  </div>
               </CardContent>
            </Card>
         </main>
      </AppShell>
   );
}
