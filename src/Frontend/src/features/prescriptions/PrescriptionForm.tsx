import { useMemo, useState } from "react";
import styles from "./PrescriptionForm.module.css";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import type { ProductDto, ProductPriceDto, SiteDto, StorageLocationDto, InventoryBalanceDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { arePrescriptionFormValuesEqual, blankPrescriptionLineValues, type PrescriptionFormValues } from "../../pages/shared/prescriptionForms";

type PrescriptionFormProps = {
   initialValues: PrescriptionFormValues;
   isSaving: boolean;
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   balances: InventoryBalanceDto[];
   prices: ProductPriceDto[];
   onSubmit: (values: PrescriptionFormValues) => Promise<void>;
};

export function PrescriptionForm({ initialValues, isSaving, products, sites, storageLocations, balances, prices, onSubmit }: PrescriptionFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const [searchQuery, setSearchQuery] = useState("");
   const [customerExpanded, setCustomerExpanded] = useState(false);
   const isDirty = !arePrescriptionFormValuesEqual(values, baselineValues);

   const saleSourceSite = useMemo(() => sites.find((site) => site.id === values.siteId) ?? null, [sites, values.siteId]);
   const saleSourceLocation = useMemo(() => storageLocations.find((location) => location.id === values.storageLocationId) ?? null, [storageLocations, values.storageLocationId]);
   const hasSaleSource = saleSourceSite !== null && saleSourceLocation !== null;

   const filteredProducts = useMemo(() => {
      if (!hasSaleSource || searchQuery.trim() === "") return [];
      const q = searchQuery.toLowerCase().trim();
      return products.filter(
         (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      ).slice(0, 20);
   }, [hasSaleSource, products, searchQuery]);

   function getProductStockInfo(productId: string) {
      const productBalances = balances.filter(
         (b) => b.productId === productId && b.siteId === values.siteId && b.storageLocationId === values.storageLocationId
      );
      const totalAvailable = productBalances.reduce((sum, b) => sum + (b.quantityOnHand - b.quantityReserved), 0);
      const bestBatch = productBalances
         .filter((b) => (b.quantityOnHand - b.quantityReserved) > 0)
         .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0] ?? null;
      return { totalAvailable, bestBatch };
   }

   function computeActivePrice(productId: string, siteId: string) {
      const now = new Date();
      const candidate = prices
         .filter(
            (p) =>
               p.productId === productId &&
               p.status === "Published" &&
               (p.siteId === siteId || p.siteId === null) &&
               new Date(p.effectiveFrom) <= now &&
               (p.effectiveTo === null || new Date(p.effectiveTo) >= now)
         )
         .sort((a, b) => {
            const aExact = a.siteId === siteId ? 1 : 0;
            const bExact = b.siteId === siteId ? 1 : 0;
            if (aExact !== bExact) return bExact - aExact;
            return new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
         })
         .at(0) ?? null;
      return candidate;
   }

   function formatPrice(price: number, currency: string) {
      try {
         return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);
      } catch {
         return `${currency} ${price.toFixed(2)}`;
      }
   }

   function isProductInTicket(productId: string) {
      return values.lines.some((line) => line.productId === productId);
   }

   function addProductToTicket(productId: string) {
      if (isProductInTicket(productId)) return;
      setValues((current) => ({
         ...current,
         lines: current.lines.some((l) => l.productId === "")
            ? current.lines.map((l) => l.productId === "" ? { ...l, productId } : l)
            : [...current.lines, { ...blankPrescriptionLineValues(), productId }],
      }));
   }

   function removeLine(index: number) {
      setValues((current) => ({
         ...current,
         lines: current.lines.filter((_, i) => i !== index),
      }));
   }

   function updateLineQuantity(index: number, prescribedQuantity: string) {
      setValues((current) => ({
         ...current,
         lines: current.lines.map((item, i) => i === index ? { ...item, prescribedQuantity } : item),
      }));
   }

   function validate() {
      if (!hasSaleSource) {
         return t("counterSale.validationHeader");
      }
      const filledLines = values.lines.filter((line) => line.productId !== "");
      if (filledLines.length === 0) {
         return t("counterSale.validationLinesRequired");
      }
      const invalidLine = filledLines.findIndex((line) => Number(line.prescribedQuantity) <= 0 || Number.isNaN(Number(line.prescribedQuantity)));
      return invalidLine >= 0 ? t("counterSale.validationLine", { line: invalidLine + 1 }) : null;
   }

   const filledLines = useMemo(() => values.lines.filter((line) => line.productId !== ""), [values.lines]);
   const productMap = useMemo(() => {
      const map = new Map<string, ProductDto>();
      for (const p of products) map.set(p.id, p);
      return map;
   }, [products]);

   return (
      <form className={styles.builder} onSubmit={async (event) => { event.preventDefault(); if (isSaving || !isDirty) return; const error = validate(); setValidationError(error); if (error !== null) return; await onSubmit(values); setBaselineValues(values); }}>
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         <div className={`${styles.source}${!hasSaleSource ? ` ${styles.sourceMissing}` : ""}`}>
            {hasSaleSource ? (
               <>
                  <span className={styles.sourceLabel}>{t("counterSale.sourceLabel")}</span>
                  <span className={styles.sourceValue}>{t("counterSale.saleSource", { site: saleSourceSite.name, location: saleSourceLocation.name })}</span>
               </>
            ) : (
               <>
                  <span className={styles.sourceLabel}>{t("counterSale.sourceMissing")}</span>
                  <span className={styles.sourceValue}>{t("counterSale.sourceMissingDesc")}</span>
               </>
            )}
         </div>

         {/* Product search */}
         <div className={styles.search}>
            <input
               className={`field-input ${styles.searchInput}`}
               type="search"
               placeholder={t("counterSale.searchProduct")}
               value={searchQuery}
               onChange={(event) => setSearchQuery(event.target.value)}
               autoComplete="off"
               disabled={!hasSaleSource}
            />
         </div>

         {/* Product search results */}
         {filteredProducts.length > 0 ? (
            <div className={styles.productSearchResults}>
               {filteredProducts.map((product) => {
                  const stockInfo = values.siteId && values.storageLocationId ? getProductStockInfo(product.id) : null;
                  const alreadyAdded = isProductInTicket(product.id);
                  return (
                     <div key={product.id} className={`${styles.productResultCard}${alreadyAdded ? ` ${styles.resultAdded}` : ""}`}>
                        <div className={styles.productResultMain}>
                           <span className={styles.productResultName}>{product.name}</span>
                           <span className={styles.productResultSku}>{product.sku}</span>
                        </div>
                        <div className={styles.productResultStock}>
                           {stockInfo !== null ? (
                              stockInfo.totalAvailable > 0 && stockInfo.bestBatch !== null ? (
                                 <span className={styles.productResultBatch}>
                                    {t("counterSale.available", { quantity: String(stockInfo.totalAvailable) })} · {t("counterSale.batchInfo", { batchNumber: stockInfo.bestBatch.batchNumber, expiryDate: new Date(stockInfo.bestBatch.expiryDate).toLocaleDateString() })}
                                 </span>
                              ) : (
                                 <span className={styles.productResultOut}>{t("counterSale.outOfStock")}</span>
                              )
                           ) : (
                              <span className={styles.productResultMuted}>{t("counterSale.sourceMissing")}</span>
                           )}
                           {(() => {
                              const activePrice = values.siteId ? computeActivePrice(product.id, values.siteId) : null;
                              return activePrice !== null ? (
                                 <span className={styles.productResultPrice}>{formatPrice(activePrice.unitPrice, activePrice.currency)}</span>
                              ) : (
                                 <span className={styles.productResultPrice}>{t("counterSale.noPrice")}</span>
                              );
                           })()}
                        </div>
                        <div className={styles.productResultActions}>
                           <Button
                              variant={alreadyAdded ? "secondary" : "primary"}
                              size="sm"
                              disabled={alreadyAdded}
                              onClick={() => addProductToTicket(product.id)}
                           >{alreadyAdded ? "✓" : t("counterSale.addProduct")}</Button>
                        </div>
                     </div>
                  );
               })}
            </div>
         ) : searchQuery.trim() !== "" ? (
            <div className={styles.productSearchEmpty}>{t("counterSale.noResults")}</div>
         ) : null}

         {/* Ticket lines */}
         {filledLines.length > 0 ? (
            <div className={styles.lines}>
               <div className="section-header">
                  <div><h3 className="section-title">{t("counterSale.ticketLines")}</h3><p className="section-subtitle">{t("counterSale.ticketLinesDesc")}</p></div>
               </div>
               {filledLines.map((line, index) => {
                  const product = productMap.get(line.productId);
                  const stockInfo = product !== undefined && values.siteId && values.storageLocationId ? getProductStockInfo(product.id) : null;
                  return (
                     <div key={line.productId} className={styles.line}>
                        <div className={styles.lineInfo}>
                           <span className={styles.lineName}>{product?.name ?? t("counterSale.unknownProduct")}</span>
                           {stockInfo !== null && stockInfo.bestBatch !== null ? (
                              <span className={styles.lineBatch}>
                                 {t("counterSale.batchInfo", { batchNumber: stockInfo.bestBatch.batchNumber, expiryDate: new Date(stockInfo.bestBatch.expiryDate).toLocaleDateString() })}
                              </span>
                           ) : null}
                           {product !== undefined ? (() => {
                              const activePrice = values.siteId ? computeActivePrice(product.id, values.siteId) : null;
                              return activePrice !== null ? (
                                 <span className={styles.linePrice}>{formatPrice(activePrice.unitPrice, activePrice.currency)}</span>
                              ) : (
                                 <span className={styles.linePrice}>{t("counterSale.noPrice")}</span>
                              );
                           })() : null}
                        </div>
                        <div className={styles.lineControls}>
                           <input
                              className={`field-input ${styles.lineQty}`}
                              type="number"
                              min="0.01"
                              step="0.01"
                              placeholder={t("counterSale.quantityLabel")}
                              value={line.prescribedQuantity}
                              onChange={(event) => updateLineQuantity(index, event.target.value)}
                           />
                           <button type="button" className={styles.lineRemove} onClick={() => removeLine(index)} aria-label={t("counterSale.removeLine")}>✕</button>
                        </div>
                     </div>
                  );
               })}
            </div>
         ) : null}

         <details className={styles.customerSection} open={customerExpanded} onToggle={(e) => setCustomerExpanded((e.target as HTMLDetailsElement).open)}>
            <summary className={styles.customerSummary}>
               {t("counterSale.customerInfo")}
               <span className={styles.customerSummaryIcon}>
                  <span className={styles.expandIcon} aria-hidden="true">+</span>
                  <span className={styles.collapseIcon} aria-hidden="true">-</span>
               </span>
            </summary>
            <div className={styles.customerFields}>
               <Field label={t("prescription.patient")}>
                  <input className="field-input" value={values.patientName} onChange={(event) => setValues((current) => ({ ...current, patientName: event.target.value }))} />
               </Field>
               <Field label={t("prescription.patientPhone")}>
                  <input className="field-input" value={values.patientPhone ?? ""} onChange={(event) => setValues((current) => ({ ...current, patientPhone: event.target.value }))} />
               </Field>
               <Field label={t("forms.notes")} className="field-wide">
                  <textarea className="field-input field-textarea" rows={2} value={values.notes ?? ""} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
               </Field>
            </div>
         </details>

         {/* Price warning */}
         <div className={styles.priceNote}>
            {(() => {
               if (!values.siteId) return null;
               const missingPriceCount = values.lines.filter((l) => l.productId !== "" && computeActivePrice(l.productId, values.siteId) === null).length;
               if (missingPriceCount > 0) {
                 return t("counterSale.missingPriceWarning", { count: String(missingPriceCount) });
               }
               return t("counterSale.priceAtPaymentNote");
            })()}
         </div>

         {/* Actions */}
         <div className="form-actions">
            <Button variant="primary" type="submit" disabled={isSaving || !isDirty || !hasSaleSource}>{isSaving ? t("common.saving") : t("counterSale.createButton")}</Button>
            <Button variant="secondary" onClick={() => { setValues(baselineValues); setValidationError(null); }} disabled={isSaving || !isDirty}>{t("common.reset")}</Button>
         </div>
      </form>
   );
}