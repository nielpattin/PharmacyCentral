import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
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
   archiveProductPrice,
   createProductPrice,
   loadProductPrices,
   loadProducts,
   loadSites,
   publishProductPrice,
   type ProductDto,
   type ProductPriceDto,
   type SiteDto,
} from "../api/pharmacyClient";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./PricingPage.module.css";

const today = new Date().toISOString().slice(0, 10);

type PriceForm = {
   productId: string;
   siteId: string;
   unitPrice: string;
   currency: string;
   effectiveFrom: string;
   effectiveTo: string;
   notes: string;
};

const blankForm: PriceForm = {
   productId: "",
   siteId: "",
   unitPrice: "",
   currency: "VND",
   effectiveFrom: today,
   effectiveTo: "",
   notes: "",
};

function priceStatusVariant(status: string) {
   if (status === "Published") return "secondary" as const;
   if (status === "Archived") return "outline" as const;
   return "default" as const;
}

export default function PricingPage() {
   const t = useT();
   const [prices, setPrices] = useState<ProductPriceDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [selectedPriceId, setSelectedPriceId] = useState("");
   const [form, setForm] = useState<PriceForm>(blankForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSaving, setIsSaving] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);

   const selectedPrice = useMemo(
      () => prices.find((price) => price.id === selectedPriceId) ?? null,
      [prices, selectedPriceId],
   );

   useMountEffect(() => {
      void refreshData();
   });

   async function refreshData(preferredPriceId?: string) {
      setIsLoading(true);
      setBannerError(null);
      try {
         const [priceData, productData, siteData] = await Promise.all([
            loadProductPrices({ limit: 200 }),
            loadProducts(),
            loadSites(),
         ]);
         setPrices(priceData);
         setProducts(productData);
         setSites(siteData);
         const nextId = preferredPriceId ?? selectedPriceId;
         setSelectedPriceId(priceData.some((price) => price.id === nextId) ? nextId : (priceData[0]?.id ?? ""));
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadPrices"));
      } finally {
         setIsLoading(false);
      }
   }

   async function handleCreate() {
      setIsSaving(true);
      setBannerError(null);
      try {
         const created = await createProductPrice({
            productId: form.productId,
            siteId: form.siteId === "" ? null : form.siteId,
            unitPrice: Number(form.unitPrice),
            currency: form.currency.trim() || "VND",
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo === "" ? null : form.effectiveTo,
            notes: form.notes.trim() || null,
         });
         setForm(blankForm);
         await refreshData(created.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handlePublish() {
      if (selectedPrice === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const updated = await publishProductPrice(selectedPrice.id);
         await refreshData(updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   async function handleArchive() {
      if (selectedPrice === null) return;
      setIsSaving(true);
      setBannerError(null);
      try {
         const updated = await archiveProductPrice(selectedPrice.id);
         await refreshData(updated.id);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.savePrice"));
      } finally {
         setIsSaving(false);
      }
   }

   return (
      <AppShell
         active="pricing"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.pricing") }]} />
         }
      >
         <div className={styles.page}>
            <PageHeader
               title={t("pricing.title")}
               actions={
                  <Button variant="outline" onClick={() => void refreshData()}>
                     {t("common.refresh")}
                  </Button>
               }
            />
            {bannerError !== null ? <div className="notice danger-note">{bannerError}</div> : null}

            <div className={styles.grid}>
               <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                     <div>
                        <CardTitle>{t("pricing.priceList")}</CardTitle>
                        <CardDescription>{t("pricing.priceListDesc")}</CardDescription>
                     </div>
                     <Badge variant="outline">
                        {prices.length} {t("common.records")}
                     </Badge>
                  </CardHeader>
                  <CardContent className={styles.cardContent}>
                     {isLoading ? (
                        <EmptyState icon="…" title={t("common.loading")} description={t("pricing.loadingDesc")} />
                     ) : prices.length === 0 ? (
                        <EmptyState icon="0" title={t("pricing.emptyTitle")} description={t("pricing.emptyDesc")} />
                     ) : (
                        <Table className={styles.table}>
                           <TableHeader>
                              <TableRow>
                                 <TableHead>{t("pricing.product")}</TableHead>
                                 <TableHead>{t("pricing.site")}</TableHead>
                                 <TableHead>{t("pricing.price")}</TableHead>
                                 <TableHead>{t("pricing.effective")}</TableHead>
                                 <TableHead>{t("pricing.status")}</TableHead>
                              </TableRow>
                           </TableHeader>
                           <TableBody>
                              <AnimatePresence mode="popLayout">
                                 {prices.map((price, index) => (
                                    <motion.tr
                                       key={price.id}
                                       layout
                                       initial={{ opacity: 0, y: 6 }}
                                       animate={{ opacity: 1, y: 0 }}
                                       exit={{ opacity: 0, y: -4 }}
                                       transition={{ duration: 0.12, delay: index * 0.01, ease: [0.2, 0, 0, 1] }}
                                       className={price.id === selectedPriceId ? styles.selectedRow : undefined}
                                       onClick={() => setSelectedPriceId(price.id)}
                                       onKeyDown={(event) => {
                                          if (event.key === "Enter") setSelectedPriceId(price.id);
                                       }}
                                       tabIndex={0}
                                    >
                                       <TableCell>
                                          <strong>{price.productSku}</strong>
                                          <span className={styles.mutedBlock}>{price.productName}</span>
                                       </TableCell>
                                       <TableCell>{price.siteName ?? t("pricing.allSites")}</TableCell>
                                       <TableCell>{formatMoney(price.unitPrice, price.currency)}</TableCell>
                                       <TableCell>
                                          {price.effectiveFrom}
                                          {price.effectiveTo ? ` → ${price.effectiveTo}` : ""}
                                       </TableCell>
                                       <TableCell>
                                          <Badge variant={priceStatusVariant(price.status)}>{price.status}</Badge>
                                       </TableCell>
                                    </motion.tr>
                                 ))}
                              </AnimatePresence>
                           </TableBody>
                        </Table>
                     )}
                  </CardContent>
               </Card>

               <Card className={styles.card}>
                  <CardHeader className={styles.cardHeader}>
                     <div>
                        <CardTitle>{t("pricing.create")}</CardTitle>
                        <CardDescription>{t("pricing.createDesc")}</CardDescription>
                     </div>
                  </CardHeader>
                  <CardContent className={styles.formGrid}>
                     <div className={styles.field}>
                        <Label>{t("pricing.product")}</Label>
                        <select
                           className="field-input"
                           value={form.productId}
                           onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
                        >
                           <option value="">{t("receiving.selectProduct")}</option>
                           {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                 {product.sku} · {product.name}
                              </option>
                           ))}
                        </select>
                     </div>
                     <div className={styles.field}>
                        <Label>{t("pricing.site")}</Label>
                        <select
                           className="field-input"
                           value={form.siteId}
                           onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value }))}
                        >
                           <option value="">{t("pricing.allSites")}</option>
                           {sites.map((site) => (
                              <option key={site.id} value={site.id}>
                                 {site.name}
                              </option>
                           ))}
                        </select>
                     </div>
                     <div className={styles.field}>
                        <Label>{t("pricing.price")}</Label>
                        <Input
                           type="number"
                           min="1"
                           step="1"
                           value={form.unitPrice}
                           onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))}
                        />
                     </div>
                     <div className={styles.field}>
                        <Label>{t("pricing.currency")}</Label>
                        <Input
                           value={form.currency}
                           maxLength={3}
                           onChange={(event) =>
                              setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                           }
                        />
                     </div>
                     <div className={styles.field}>
                        <Label>{t("pricing.effectiveFrom")}</Label>
                        <Input
                           type="date"
                           value={form.effectiveFrom}
                           onChange={(event) =>
                              setForm((current) => ({ ...current, effectiveFrom: event.target.value }))
                           }
                        />
                     </div>
                     <div className={styles.field}>
                        <Label>{t("pricing.effectiveTo")}</Label>
                        <Input
                           type="date"
                           value={form.effectiveTo}
                           onChange={(event) => setForm((current) => ({ ...current, effectiveTo: event.target.value }))}
                        />
                     </div>
                     <div className={`${styles.field} ${styles.fieldWide}`}>
                        <Label>{t("forms.notes")}</Label>
                        <Textarea
                           rows={3}
                           value={form.notes}
                           onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                        />
                     </div>
                     <div className={styles.actions}>
                        <Button
                           disabled={isSaving || form.productId === "" || form.unitPrice === ""}
                           onClick={() => void handleCreate()}
                        >
                           {isSaving ? t("common.saving") : t("pricing.createButton")}
                        </Button>
                     </div>
                  </CardContent>
               </Card>
            </div>

            <Card className={styles.card}>
               <CardHeader className={styles.cardHeader}>
                  <div>
                     <CardTitle>{t("pricing.details")}</CardTitle>
                     <CardDescription>
                        {selectedPrice === null ? t("pricing.selectPriceDesc") : selectedPrice.productName}
                     </CardDescription>
                  </div>
                  <div className={styles.actionsInline}>
                     <Button
                        disabled={selectedPrice === null || selectedPrice.status !== "Draft" || isSaving}
                        onClick={() => void handlePublish()}
                     >
                        {t("pricing.publish")}
                     </Button>
                     <Button
                        variant="outline"
                        disabled={selectedPrice === null || selectedPrice.status === "Archived" || isSaving}
                        onClick={() => void handleArchive()}
                     >
                        {t("pricing.archive")}
                     </Button>
                  </div>
               </CardHeader>
               <CardContent>
                  {selectedPrice === null ? (
                     <EmptyState icon="₫" title={t("pricing.selectPrice")} description={t("pricing.selectPriceDesc")} />
                  ) : (
                     <div className={styles.detailStrip}>
                        <span>
                           {selectedPrice.productSku} · {selectedPrice.productName}
                        </span>
                        <span>{selectedPrice.siteName ?? t("pricing.allSites")}</span>
                        <span>{formatMoney(selectedPrice.unitPrice, selectedPrice.currency)}</span>
                        <Badge variant={priceStatusVariant(selectedPrice.status)}>{selectedPrice.status}</Badge>
                     </div>
                  )}
               </CardContent>
            </Card>
         </div>
      </AppShell>
   );
}

function formatMoney(value: number, currency: string) {
   return new Intl.NumberFormat("vi-VN", { style: "currency", currency }).format(value);
}
