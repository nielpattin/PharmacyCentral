import { useMemo, useState } from "react";
import {
   createReturn,
   loadInventoryBalances,
   loadProducts,
   loadSites,
   loadStockLedgerEntries,
   loadStorageLocations,
   type InventoryBalanceDto,
   type ProductDto,
   type SiteDto,
   type StockLedgerEntryDto,
   type StorageLocationDto,
} from "../api/pharmacyClient";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { useMountEffect } from "../hooks/useMountEffect";
import { useT } from "../lib/i18n";
import styles from "./ReturnsPage.module.css";

type ReturnReason = "ReturnToSupplier" | "Damaged" | "Expired" | "InventoryRemoval";

type ReturnFormState = {
   productId: string;
   balanceId: string;
   quantity: string;
   reason: ReturnReason;
   destination: string;
   occurredAtLocal: string;
   notes: string;
};

const returnReasons: ReturnReason[] = ["ReturnToSupplier", "Damaged", "Expired", "InventoryRemoval"];

const returnMovementTypes = new Set(["ReturnToSupplier", "InventoryReturn"]);

const defaultForm: ReturnFormState = {
   productId: "",
   balanceId: "",
   quantity: "",
   reason: "ReturnToSupplier",
   destination: "",
   occurredAtLocal: "",
   notes: "",
};

function formatQuantity(value: number) {
   return new Intl.NumberFormat().format(value);
}

function toApiDateTime(value: string) {
   if (value === "") {
      return null;
   }

   const parsed = new Date(value);
   if (Number.isNaN(parsed.getTime())) {
      return null;
   }

   return parsed.toISOString();
}

function siteName(sites: SiteDto[], siteId: string) {
   return sites.find((site) => site.id === siteId)?.name ?? "—";
}

function locationName(locations: StorageLocationDto[], locationId: string) {
   return locations.find((location) => location.id === locationId)?.name ?? "—";
}

function availableQuantity(balance: InventoryBalanceDto) {
   return balance.quantityOnHand - balance.quantityReserved;
}

function isReturnLedgerEntry(entry: StockLedgerEntryDto) {
   return returnMovementTypes.has(entry.movementType);
}

export default function ReturnsPage() {
   const t = useT();
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [ledgerEntries, setLedgerEntries] = useState<StockLedgerEntryDto[]>([]);
   const [form, setForm] = useState<ReturnFormState>(defaultForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [successMessage, setSuccessMessage] = useState<string | null>(null);

   useMountEffect(() => {
      void refreshData();
   });

   const filteredBalances = useMemo(() => {
      return balances
         .filter((balance) => balance.quantityOnHand > 0)
         .filter((balance) => form.productId === "" || balance.productId === form.productId)
         .sort((left, right) => {
            const productCompare = left.productName.localeCompare(right.productName);
            if (productCompare !== 0) {
               return productCompare;
            }

            return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
         });
   }, [balances, form.productId]);

   const selectedBalance = useMemo(
      () => balances.find((balance) => balance.id === form.balanceId) ?? null,
      [balances, form.balanceId],
   );

   const recentReturns = useMemo(() => ledgerEntries.filter(isReturnLedgerEntry).slice(0, 12), [ledgerEntries]);

   const quantity = Number(form.quantity);
   const selectedAvailable = selectedBalance === null ? 0 : availableQuantity(selectedBalance);
   const canSubmit =
      selectedBalance !== null &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      quantity <= selectedBalance.quantityOnHand;

   async function refreshData() {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [balanceData, productData, siteData, locationData, ledgerData] = await Promise.all([
            loadInventoryBalances(),
            loadProducts(),
            loadSites(),
            loadStorageLocations(),
            loadStockLedgerEntries({ limit: 100 }),
         ]);

         setBalances(balanceData);
         setProducts(productData);
         setSites(siteData);
         setStorageLocations(locationData);
         setLedgerEntries(ledgerData);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("returns.loadError"));
      } finally {
         setIsLoading(false);
      }
   }

   function updateForm(nextForm: ReturnFormState) {
      setForm(nextForm);
      setBannerError(null);
      setSuccessMessage(null);
   }

   async function handleSubmit() {
      if (selectedBalance === null) {
         setBannerError(t("returns.selectBalanceRequired"));
         return;
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
         setBannerError(t("returns.quantityRequired"));
         return;
      }

      if (quantity > selectedBalance.quantityOnHand) {
         setBannerError(t("returns.quantityExceedsStock"));
         return;
      }

      setIsSubmitting(true);
      setBannerError(null);
      setSuccessMessage(null);

      try {
         await createReturn({
            productId: selectedBalance.productId,
            productBatchId: selectedBalance.productBatchId,
            siteId: selectedBalance.siteId,
            storageLocationId: selectedBalance.storageLocationId,
            quantity,
            reason: form.reason,
            destination: form.destination.trim() === "" ? null : form.destination.trim(),
            occurredAtUtc: toApiDateTime(form.occurredAtLocal),
            notes: form.notes.trim() === "" ? null : form.notes.trim(),
         });

         setForm(defaultForm);
         setSuccessMessage(t("returns.posted"));
         await refreshData();
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("returns.submitError"));
      } finally {
         setIsSubmitting(false);
      }
   }

   return (
      <AppShell
         active="returns"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.returns") }]} />
         }
      >
         <div className={styles.returnsPage}>
            <PageHeader
               title={t("returns.title")}
               description={t("returns.description")}
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

            <div className={styles.returnsGrid}>
               <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("returns.formTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("returns.formDesc")}</p>
                        </div>
                     </div>

                     <div className="grid gap-3">
                        <Field label={t("returns.product")}>
                           <select
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.productId}
                              onChange={(event) =>
                                 updateForm({ ...form, productId: event.target.value, balanceId: "" })
                              }
                           >
                              <option value="">{t("returns.allProducts")}</option>
                              {products.map((product) => (
                                 <option key={product.id} value={product.id}>
                                    {product.sku} · {product.name}
                                 </option>
                              ))}
                           </select>
                        </Field>

                        <Field label={t("returns.balance")}>
                           <select
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.balanceId}
                              onChange={(event) => updateForm({ ...form, balanceId: event.target.value })}
                              disabled={isLoading}
                           >
                              <option value="">{t("returns.selectBalance")}</option>
                              {filteredBalances.map((balance) => (
                                 <option key={balance.id} value={balance.id}>
                                    {balance.productName} · {balance.batchNumber} · {siteName(sites, balance.siteId)} ·{" "}
                                    {formatQuantity(balance.quantityOnHand)}
                                 </option>
                              ))}
                           </select>
                        </Field>

                        <Field label={t("returns.quantity")}>
                           <input
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              type="number"
                              min="0"
                              step="0.01"
                              value={form.quantity}
                              onChange={(event) => updateForm({ ...form, quantity: event.target.value })}
                           />
                        </Field>

                        <Field label={t("returns.reason")}>
                           <select
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.reason}
                              onChange={(event) => updateForm({ ...form, reason: event.target.value as ReturnReason })}
                           >
                              {returnReasons.map((reason) => (
                                 <option key={reason} value={reason}>
                                    {t(`returns.reason.${reason}`)}
                                 </option>
                              ))}
                           </select>
                        </Field>

                        <Field label={t("returns.destination")}>
                           <input
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.destination}
                              onChange={(event) => updateForm({ ...form, destination: event.target.value })}
                              placeholder={t("returns.destinationPlaceholder")}
                           />
                        </Field>

                        <Field label={t("returns.occurredAt")}>
                           <input
                              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              type="datetime-local"
                              value={form.occurredAtLocal}
                              onChange={(event) => updateForm({ ...form, occurredAtLocal: event.target.value })}
                           />
                        </Field>

                        <Field label={t("returns.notes")} className="col-span-full">
                           <textarea
                              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                              value={form.notes}
                              onChange={(event) => updateForm({ ...form, notes: event.target.value })}
                              placeholder={t("returns.notesPlaceholder")}
                           />
                        </Field>
                     </div>

                     {selectedBalance !== null ? (
                        <div className={styles.returnsStockContext}>
                           <div>
                              <span>{t("returns.selectedBatch")}</span>
                              <strong>
                                 {selectedBalance.productName} · {selectedBalance.batchNumber}
                              </strong>
                           </div>
                           <div>
                              <span>{t("returns.selectedLocation")}</span>
                              <strong>
                                 {siteName(sites, selectedBalance.siteId)} ·{" "}
                                 {locationName(storageLocations, selectedBalance.storageLocationId)}
                              </strong>
                           </div>
                           <div>
                              <span>{t("returns.onHand")}</span>
                              <strong>{formatQuantity(selectedBalance.quantityOnHand)}</strong>
                           </div>
                           <div>
                              <span>{t("returns.available")}</span>
                              <strong>{formatQuantity(selectedAvailable)}</strong>
                           </div>
                        </div>
                     ) : null}

                     <div className="flex flex-wrap justify-end gap-2">
                        <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSubmitting}>
                           {isSubmitting ? t("returns.submitting") : t("returns.submit")}
                        </Button>
                        <Button variant="outline" onClick={() => updateForm(defaultForm)} disabled={isSubmitting}>
                           {t("common.reset")}
                        </Button>
                     </div>
                  </div>
               </section>

               <section className="rounded-md border border-border bg-card text-card-foreground shadow-none">
                  <div className="p-4">
                     <div className="flex items-start justify-between gap-3">
                        <div>
                           <h2 className="m-0 text-sm font-semibold text-foreground">{t("returns.recentTitle")}</h2>
                           <p className="mt-1 text-sm text-muted-foreground">{t("returns.recentDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {recentReturns.length} {t("common.records")}
                        </Badge>
                     </div>

                     {isLoading ? (
                        <EmptyState icon="…" title={t("returns.loading")} description={t("returns.fetching")} />
                     ) : recentReturns.length === 0 ? (
                        <EmptyState icon="0" title={t("returns.emptyTitle")} description={t("returns.emptyDesc")} />
                     ) : (
                        <div className={styles.returnsHistoryList}>
                           {recentReturns.map((entry) => (
                              <article key={entry.id} className={styles.returnsHistoryItem}>
                                 <div>
                                    <div className={styles.moduleHead}>
                                       <Badge variant="outline">{t(`returns.movement.${entry.movementType}`)}</Badge>
                                       <h3>{entry.productName}</h3>
                                    </div>
                                    <p>
                                       {entry.batchNumber} · {siteName(sites, entry.siteId)} ·{" "}
                                       {locationName(storageLocations, entry.storageLocationId)}
                                    </p>
                                    <span>
                                       {entry.reason === null
                                          ? t("returns.noReason")
                                          : t(`returns.reason.${entry.reason}`)}{" "}
                                       · {entry.notes ?? t("common.noData")}
                                    </span>
                                 </div>
                                 <div className={styles.returnsHistoryMeta}>
                                    <strong>{formatQuantity(Math.abs(entry.quantityDelta))}</strong>
                                    <span>
                                       {t("returns.balanceAfter", { value: formatQuantity(entry.balanceAfter) })}
                                    </span>
                                    <time>{new Date(entry.occurredAtUtc).toLocaleString()}</time>
                                 </div>
                              </article>
                           ))}
                        </div>
                     )}
                  </div>
               </section>
            </div>
         </div>
      </AppShell>
   );
}
