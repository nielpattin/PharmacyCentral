import { useMemo, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumbs } from "../components/layout/Breadcrumbs";
import { PageHeader } from "../components/layout/PageHeader";
import { Badge } from "../components/shadcn/badge";
import { Button } from "../components/shadcn/button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import {
   createInventoryMovement,
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
import { InventoryBalanceTable } from "../features/inventory/InventoryBalanceTable";
import { useMountEffect } from "../hooks/useMountEffect";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import styles from "./InventoryPage.module.css";

type InventoryFilters = {
   productId: string;
   siteId: string;
   storageLocationId: string;
   includeZeroBalances: boolean;
};

type LedgerFilters = {
   productId: string;
   siteId: string;
   storageLocationId: string;
   limit: number;
};

type MovementForm = {
   balanceId: string;
   quantityDelta: string;
   reason: string;
   occurredAt: string;
   notes: string;
};

const defaultFilters: InventoryFilters = {
   productId: "",
   siteId: "",
   storageLocationId: "",
   includeZeroBalances: false,
};

const defaultLedgerFilters: LedgerFilters = {
   productId: "",
   siteId: "",
   storageLocationId: "",
   limit: 50,
};

const defaultMovementForm: MovementForm = {
   balanceId: "",
   quantityDelta: "",
   reason: "",
   occurredAt: "",
   notes: "",
};

function formatQuantity(value: number) {
   return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatDateTime(value: string) {
   return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
   }).format(new Date(value));
}

function siteName(sites: SiteDto[], siteId: string) {
   return sites.find((site) => site.id === siteId)?.name ?? "—";
}

function locationName(locations: StorageLocationDto[], locationId: string) {
   return locations.find((location) => location.id === locationId)?.name ?? "—";
}

function toIsoDateTime(value: string) {
   if (value === "") {
      return null;
   }

   return new Date(value).toISOString();
}

export default function InventoryPage() {
   const t = useT();
   const authUser = useAuth();
   const [balances, setBalances] = useState<InventoryBalanceDto[]>([]);
   const [ledgerEntries, setLedgerEntries] = useState<StockLedgerEntryDto[]>([]);
   const [products, setProducts] = useState<ProductDto[]>([]);
   const [sites, setSites] = useState<SiteDto[]>([]);
   const [storageLocations, setStorageLocations] = useState<StorageLocationDto[]>([]);
   const [filters, setFilters] = useState<InventoryFilters>(defaultFilters);
   const [ledgerFilters, setLedgerFilters] = useState<LedgerFilters>(defaultLedgerFilters);
   const [movementForm, setMovementForm] = useState<MovementForm>(defaultMovementForm);
   const [isLoading, setIsLoading] = useState(true);
   const [isSubmittingMovement, setIsSubmittingMovement] = useState(false);
   const [bannerError, setBannerError] = useState<string | null>(null);
   const [successMessage, setSuccessMessage] = useState<string | null>(null);

   const availableStorageLocations = useMemo(() => {
      if (filters.siteId === "") {
         return storageLocations;
      }

      return storageLocations.filter((location) => location.siteId === filters.siteId);
   }, [filters.siteId, storageLocations]);

   const ledgerStorageLocations = useMemo(() => {
      if (ledgerFilters.siteId === "") {
         return storageLocations;
      }

      return storageLocations.filter((location) => location.siteId === ledgerFilters.siteId);
   }, [ledgerFilters.siteId, storageLocations]);

   const selectedBalance = useMemo(
      () => balances.find((balance) => balance.id === movementForm.balanceId) ?? null,
      [balances, movementForm.balanceId],
   );

   const quantityDelta = Number(movementForm.quantityDelta);
   const isMovementQuantityValid = Number.isFinite(quantityDelta) && quantityDelta !== 0;
   const movementError = getMovementError(selectedBalance, movementForm, quantityDelta, t);
   const canSubmitMovement =
      selectedBalance !== null &&
      isMovementQuantityValid &&
      movementForm.reason.trim() !== "" &&
      movementError === null;
   const canControlInventory =
      authUser?.isPlatformAdmin === true || authUser?.roles.includes("Warehouse Staff") === true;

   useMountEffect(() => {
      void refreshData(defaultFilters, defaultLedgerFilters);
   });

   async function refreshData(nextFilters = filters, nextLedgerFilters = ledgerFilters) {
      setIsLoading(true);
      setBannerError(null);

      try {
         const [balanceData, ledgerData, productData, siteData, storageLocationData] = await Promise.all([
            loadInventoryBalances({
               productId: nextFilters.productId,
               siteId: nextFilters.siteId,
               storageLocationId: nextFilters.storageLocationId,
               includeZeroBalances: nextFilters.includeZeroBalances,
            }),
            loadStockLedgerEntries({
               productId: nextLedgerFilters.productId,
               siteId: nextLedgerFilters.siteId,
               storageLocationId: nextLedgerFilters.storageLocationId,
               limit: nextLedgerFilters.limit,
            }),
            loadProducts(),
            loadSites(),
            loadStorageLocations(),
         ]);
         setBalances(balanceData);
         setLedgerEntries(ledgerData);
         setProducts(productData);
         setSites(siteData);
         setStorageLocations(storageLocationData);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("errors.loadInventoryBalances"));
      } finally {
         setIsLoading(false);
      }
   }

   function updateFilters(nextFilters: InventoryFilters) {
      setFilters(nextFilters);
      void refreshData(nextFilters, ledgerFilters);
   }

   function updateLedgerFilters(nextFilters: LedgerFilters) {
      setLedgerFilters(nextFilters);
      void refreshData(filters, nextFilters);
   }

   function updateMovementForm(nextForm: MovementForm) {
      setMovementForm(nextForm);
      setBannerError(null);
      setSuccessMessage(null);
   }

   function handleResetFilters() {
      setFilters(defaultFilters);
      void refreshData(defaultFilters, ledgerFilters);
   }

   function handleResetLedgerFilters() {
      setLedgerFilters(defaultLedgerFilters);
      void refreshData(filters, defaultLedgerFilters);
   }

   function handleUseBalance(balance: InventoryBalanceDto) {
      setMovementForm({
         ...movementForm,
         balanceId: balance.id,
      });
      setSuccessMessage(null);
      setBannerError(null);
   }

   function handleResetMovementForm() {
      setMovementForm(defaultMovementForm);
      setSuccessMessage(null);
      setBannerError(null);
   }

   async function handleSubmitMovement() {
      if (selectedBalance === null || !canSubmitMovement) {
         setBannerError(movementError ?? t("inventory.movementSelectBalance"));
         return;
      }

      setIsSubmittingMovement(true);
      setBannerError(null);
      setSuccessMessage(null);

      try {
         await createInventoryMovement({
            productId: selectedBalance.productId,
            productBatchId: selectedBalance.productBatchId,
            siteId: selectedBalance.siteId,
            storageLocationId: selectedBalance.storageLocationId,
            movementType: "ManualAdjustment",
            quantityDelta,
            occurredAtUtc: toIsoDateTime(movementForm.occurredAt),
            referenceType: "ManualInventoryMovement",
            referenceId: null,
            reason: movementForm.reason.trim(),
            notes: movementForm.notes.trim() === "" ? null : movementForm.notes.trim(),
         });

         setSuccessMessage(t("inventory.movementPosted"));
         setMovementForm(defaultMovementForm);
         await refreshData(filters, ledgerFilters);
      } catch (error) {
         setBannerError(error instanceof Error ? error.message : t("inventory.movementSubmitError"));
      } finally {
         setIsSubmittingMovement(false);
      }
   }

   return (
      <AppShell
         active="inventory"
         breadcrumb={
            <Breadcrumbs items={[{ label: t("app.brand"), href: "/dashboard" }, { label: t("nav.inventory") }]} />
         }
      >
         <div className={styles.inventoryPage}>
            <PageHeader
               title={t("inventory.title")}
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

            <section className="card">
               <div className="section">
                  <div className="section-header">
                     <div>
                        <h2 className="section-title">{t("inventory.registry")}</h2>
                        <p className="section-subtitle">{t("inventory.registryDesc")}</p>
                     </div>
                     <Badge variant="outline">
                        {isLoading ? t("inventory.loadingState") : `${balances.length} ${t("common.records")}`}
                     </Badge>
                  </div>
                  <div className="form-grid">
                     <Field label={t("inventory.productFilter")}>
                        <select
                           className="field-input"
                           value={filters.productId}
                           onChange={(event) => updateFilters({ ...filters, productId: event.target.value })}
                        >
                           <option value="">{t("inventory.allProducts")}</option>
                           {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                 {product.sku} · {product.name}
                              </option>
                           ))}
                        </select>
                     </Field>
                     <Field label={t("inventory.siteFilter")}>
                        <select
                           className="field-input"
                           value={filters.siteId}
                           onChange={(event) =>
                              updateFilters({ ...filters, siteId: event.target.value, storageLocationId: "" })
                           }
                        >
                           <option value="">{t("inventory.allSites")}</option>
                           {sites.map((site) => (
                              <option key={site.id} value={site.id}>
                                 {site.name}
                              </option>
                           ))}
                        </select>
                     </Field>
                     <Field label={t("inventory.locationFilter")}>
                        <select
                           className="field-input"
                           value={filters.storageLocationId}
                           onChange={(event) => updateFilters({ ...filters, storageLocationId: event.target.value })}
                        >
                           <option value="">{t("inventory.allLocations")}</option>
                           {availableStorageLocations.map((location) => (
                              <option key={location.id} value={location.id}>
                                 {location.name}
                              </option>
                           ))}
                        </select>
                     </Field>
                     <label className="field field-inline">
                        <span className="field-label">{t("inventory.includeZeroBalances")}</span>
                        <input
                           className="field-check"
                           type="checkbox"
                           checked={filters.includeZeroBalances}
                           onChange={(event) =>
                              updateFilters({ ...filters, includeZeroBalances: event.target.checked })
                           }
                        />
                     </label>
                  </div>
                  <div className="form-actions">
                     <Button variant="outline" onClick={handleResetFilters}>
                        {t("inventory.clearFilters")}
                     </Button>
                  </div>
                  {isLoading ? (
                     <EmptyState icon="…" title={t("inventory.loading")} description={t("inventory.fetching")} />
                  ) : balances.length === 0 ? (
                     <EmptyState icon="0" title={t("inventory.emptyTitle")} description={t("inventory.emptyDesc")} />
                  ) : (
                     <InventoryBalanceTable
                        rows={balances}
                        sites={sites}
                        storageLocations={storageLocations}
                        onUseBalance={canControlInventory ? handleUseBalance : undefined}
                     />
                  )}
               </div>
            </section>

            <div className={canControlInventory ? styles.inventoryOperationsGrid : styles.inventoryHistoryOnly}>
               {canControlInventory ? (
                  <section className="card">
                     <div className="section">
                        <div className="section-header">
                           <div>
                              <h2 className="section-title">{t("inventory.movementTitle")}</h2>
                              <p className="section-subtitle">{t("inventory.movementDesc")}</p>
                           </div>
                           <Badge variant="outline">{t("inventory.manual")}</Badge>
                        </div>
                        <div className="entity-form">
                           <Field label={t("inventory.movementBalance")} required>
                              <select
                                 className="field-input"
                                 value={movementForm.balanceId}
                                 onChange={(event) =>
                                    updateMovementForm({ ...movementForm, balanceId: event.target.value })
                                 }
                              >
                                 <option value="">{t("inventory.selectBalance")}</option>
                                 {balances.map((balance) => (
                                    <option key={balance.id} value={balance.id}>
                                       {balance.productName} · {balance.batchNumber} · {siteName(sites, balance.siteId)}{" "}
                                       · {formatQuantity(balance.quantityOnHand)}
                                    </option>
                                 ))}
                              </select>
                           </Field>
                           <Field label={t("inventory.quantityDelta")} hint={t("inventory.quantityDeltaHint")} required>
                              <input
                                 className="field-input"
                                 type="number"
                                 step="0.01"
                                 value={movementForm.quantityDelta}
                                 onChange={(event) =>
                                    updateMovementForm({ ...movementForm, quantityDelta: event.target.value })
                                 }
                              />
                           </Field>
                           <Field label={t("inventory.reason")} required>
                              <input
                                 className="field-input"
                                 value={movementForm.reason}
                                 onChange={(event) =>
                                    updateMovementForm({ ...movementForm, reason: event.target.value })
                                 }
                                 placeholder={t("inventory.reasonPlaceholder")}
                                 maxLength={200}
                              />
                           </Field>
                           <Field label={t("inventory.occurredAt")}>
                              <input
                                 className="field-input"
                                 type="datetime-local"
                                 value={movementForm.occurredAt}
                                 onChange={(event) =>
                                    updateMovementForm({ ...movementForm, occurredAt: event.target.value })
                                 }
                              />
                           </Field>
                           <Field label={t("inventory.notes")} className="field-wide">
                              <textarea
                                 className="field-input field-textarea"
                                 value={movementForm.notes}
                                 onChange={(event) =>
                                    updateMovementForm({ ...movementForm, notes: event.target.value })
                                 }
                                 placeholder={t("inventory.notesPlaceholder")}
                                 maxLength={1000}
                              />
                           </Field>
                        </div>

                        {selectedBalance !== null ? (
                           <div className={styles.inventoryStockContext}>
                              <div>
                                 <span>{t("inventory.selectedBatch")}</span>
                                 <strong>
                                    {selectedBalance.productName} · {selectedBalance.batchNumber}
                                 </strong>
                              </div>
                              <div>
                                 <span>{t("inventory.selectedLocation")}</span>
                                 <strong>
                                    {siteName(sites, selectedBalance.siteId)} ·{" "}
                                    {locationName(storageLocations, selectedBalance.storageLocationId)}
                                 </strong>
                              </div>
                              <div>
                                 <span>{t("inventory.quantityOnHand")}</span>
                                 <strong>{formatQuantity(selectedBalance.quantityOnHand)}</strong>
                              </div>
                              <div>
                                 <span>{t("inventory.quantityReserved")}</span>
                                 <strong>{formatQuantity(selectedBalance.quantityReserved)}</strong>
                              </div>
                           </div>
                        ) : null}

                        {movementError !== null ? (
                           <div className={`notice warning ${styles.inventoryMovementWarning}`}>{movementError}</div>
                        ) : null}

                        <div className="form-actions">
                           <Button
                              onClick={() => void handleSubmitMovement()}
                              disabled={!canSubmitMovement || isSubmittingMovement}
                           >
                              {isSubmittingMovement ? t("inventory.movementSubmitting") : t("inventory.movementSubmit")}
                           </Button>
                           <Button variant="outline" onClick={handleResetMovementForm}>
                              {t("common.reset")}
                           </Button>
                        </div>
                     </div>
                  </section>
               ) : null}
               <section className="card">
                  <div className="section">
                     <div className="section-header">
                        <div>
                           <h2 className="section-title">{t("inventory.ledgerTitle")}</h2>
                           <p className="section-subtitle">{t("inventory.ledgerDesc")}</p>
                        </div>
                        <Badge variant="outline">
                           {ledgerEntries.length} {t("common.records")}
                        </Badge>
                     </div>
                     <div className={`form-grid ${styles.inventoryLedgerFilters}`}>
                        <Field label={t("inventory.productFilter")}>
                           <select
                              className="field-input"
                              value={ledgerFilters.productId}
                              onChange={(event) =>
                                 updateLedgerFilters({ ...ledgerFilters, productId: event.target.value })
                              }
                           >
                              <option value="">{t("inventory.allProducts")}</option>
                              {products.map((product) => (
                                 <option key={product.id} value={product.id}>
                                    {product.sku} · {product.name}
                                 </option>
                              ))}
                           </select>
                        </Field>
                        <Field label={t("inventory.siteFilter")}>
                           <select
                              className="field-input"
                              value={ledgerFilters.siteId}
                              onChange={(event) =>
                                 updateLedgerFilters({
                                    ...ledgerFilters,
                                    siteId: event.target.value,
                                    storageLocationId: "",
                                 })
                              }
                           >
                              <option value="">{t("inventory.allSites")}</option>
                              {sites.map((site) => (
                                 <option key={site.id} value={site.id}>
                                    {site.name}
                                 </option>
                              ))}
                           </select>
                        </Field>
                        <Field label={t("inventory.locationFilter")}>
                           <select
                              className="field-input"
                              value={ledgerFilters.storageLocationId}
                              onChange={(event) =>
                                 updateLedgerFilters({ ...ledgerFilters, storageLocationId: event.target.value })
                              }
                           >
                              <option value="">{t("inventory.allLocations")}</option>
                              {ledgerStorageLocations.map((location) => (
                                 <option key={location.id} value={location.id}>
                                    {location.name}
                                 </option>
                              ))}
                           </select>
                        </Field>
                        <Field label={t("inventory.limit")}>
                           <select
                              className="field-input"
                              value={ledgerFilters.limit}
                              onChange={(event) =>
                                 updateLedgerFilters({ ...ledgerFilters, limit: Number(event.target.value) })
                              }
                           >
                              {[25, 50, 100, 200].map((limit) => (
                                 <option key={limit} value={limit}>
                                    {limit}
                                 </option>
                              ))}
                           </select>
                        </Field>
                     </div>
                     <div className={`form-actions ${styles.inventoryLedgerActions}`}>
                        <Button variant="outline" onClick={handleResetLedgerFilters}>
                           {t("inventory.clearLedgerFilters")}
                        </Button>
                     </div>
                     {isLoading ? (
                        <EmptyState
                           icon="…"
                           title={t("inventory.ledgerLoading")}
                           description={t("inventory.ledgerFetching")}
                        />
                     ) : ledgerEntries.length === 0 ? (
                        <EmptyState
                           icon="0"
                           title={t("inventory.ledgerEmptyTitle")}
                           description={t("inventory.ledgerEmptyDesc")}
                        />
                     ) : (
                        <InventoryLedgerTable
                           entries={ledgerEntries}
                           sites={sites}
                           storageLocations={storageLocations}
                        />
                     )}
                  </div>
               </section>
            </div>
         </div>
      </AppShell>
   );
}

function getMovementError(
   selectedBalance: InventoryBalanceDto | null,
   form: MovementForm,
   quantityDelta: number,
   t: (key: string, params?: Record<string, string | number>) => string,
) {
   if (selectedBalance === null) {
      return null;
   }

   if (form.quantityDelta.trim() === "") {
      return null;
   }

   if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      return t("inventory.quantityDeltaRequired");
   }

   if (quantityDelta < 0 && Math.abs(quantityDelta) > selectedBalance.quantityOnHand) {
      return t("inventory.quantityDeltaExceedsStock");
   }

   if (form.reason.trim() === "") {
      return t("inventory.reasonRequired");
   }

   return null;
}

function InventoryLedgerTable({
   entries,
   sites,
   storageLocations,
}: {
   entries: StockLedgerEntryDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
}) {
   const t = useT();

   return (
      <div className="table-wrap">
         <table className={styles.inventoryLedgerTable}>
            <thead>
               <tr>
                  <th>{t("inventory.productName")}</th>
                  <th>{t("inventory.site")}</th>
                  <th>{t("inventory.movementType")}</th>
                  <th>{t("inventory.quantityDelta")}</th>
                  <th>{t("inventory.balanceAfter")}</th>
                  <th>{t("inventory.reason")}</th>
                  <th>{t("inventory.occurredAt")}</th>
               </tr>
            </thead>
            <tbody>
               {entries.map((entry) => (
                  <tr key={entry.id}>
                     <td>
                        <div className={styles.tableStrong}>{entry.productName}</div>
                        <div className={styles.tableMuted}>
                           {entry.productSku} · {entry.batchNumber}
                        </div>
                     </td>
                     <td>
                        <div className={styles.tableStrong}>{siteName(sites, entry.siteId)}</div>
                        <div className={styles.tableMuted}>
                           {locationName(storageLocations, entry.storageLocationId)}
                        </div>
                     </td>
                     <td>{formatMovementType(entry.movementType)}</td>
                     <td>
                        <Badge variant={entry.quantityDelta >= 0 ? "secondary" : "outline"}>
                           {formatQuantity(entry.quantityDelta)}
                        </Badge>
                     </td>
                     <td>{formatQuantity(entry.balanceAfter)}</td>
                     <td>{entry.reason ?? t("common.noData")}</td>
                     <td>{formatDateTime(entry.occurredAtUtc)}</td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
   );
}

function formatMovementType(value: string) {
   return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}
