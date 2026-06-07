import { useMemo, useState } from "react";
import styles from "./PrescriptionForm.module.css";
import { Badge } from "../../components/shadcn/badge";
import { Button } from "../../components/shadcn/button";
import { Card, CardContent } from "../../components/shadcn/card";
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from "../../components/shadcn/command";
import { Input } from "../../components/shadcn/input";
import { Label } from "../../components/shadcn/label";
import { Textarea } from "../../components/shadcn/textarea";
import { MotionList, MotionListItem } from "../../components/motion/MotionList";
import type {
   ProductDto,
   ProductPriceDto,
   SiteDto,
   StorageLocationDto,
   InventoryBalanceDto,
} from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import {
   arePrescriptionFormValuesEqual,
   blankPrescriptionLineValues,
   type PrescriptionFormValues,
} from "../../pages/shared/prescriptionForms";

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

type StockInfo = {
   totalAvailable: number;
   bestBatch: InventoryBalanceDto | null;
};

export function PrescriptionForm({
   initialValues,
   isSaving,
   products,
   sites,
   storageLocations,
   balances,
   prices,
   onSubmit,
}: PrescriptionFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const [searchQuery, setSearchQuery] = useState("");
   const [customerExpanded, setCustomerExpanded] = useState(false);
   const isDirty = !arePrescriptionFormValuesEqual(values, baselineValues);

   const saleSourceSite = useMemo(
      () => sites.find((site) => site.id === values.siteId) ?? null,
      [sites, values.siteId],
   );
   const saleSourceLocation = useMemo(
      () => storageLocations.find((location) => location.id === values.storageLocationId) ?? null,
      [storageLocations, values.storageLocationId],
   );
   const hasSaleSource = saleSourceSite !== null && saleSourceLocation !== null;

   const filteredProducts = useMemo(() => {
      if (!hasSaleSource || searchQuery.trim() === "") return [];
      const q = searchQuery.toLowerCase().trim();
      return products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 20);
   }, [hasSaleSource, products, searchQuery]);

   const productMap = useMemo(() => {
      const map = new Map<string, ProductDto>();
      for (const product of products) {
         map.set(product.id, product);
      }
      return map;
   }, [products]);

   const filledLines = useMemo(() => values.lines.filter((line) => line.productId !== ""), [values.lines]);

   function getProductStockInfo(productId: string): StockInfo {
      const productBalances = balances.filter(
         (balance) =>
            balance.productId === productId &&
            balance.siteId === values.siteId &&
            balance.storageLocationId === values.storageLocationId,
      );
      const totalAvailable = productBalances.reduce(
         (sum, balance) => sum + (balance.quantityOnHand - balance.quantityReserved),
         0,
      );
      const bestBatch =
         productBalances
            .filter((balance) => balance.quantityOnHand - balance.quantityReserved > 0)
            .sort((left, right) => new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime())[0] ??
         null;
      return { totalAvailable, bestBatch };
   }

   function computeActivePrice(productId: string, siteId: string) {
      const now = new Date();
      return (
         prices
            .filter(
               (price) =>
                  price.productId === productId &&
                  price.status === "Published" &&
                  (price.siteId === siteId || price.siteId === null) &&
                  new Date(price.effectiveFrom) <= now &&
                  (price.effectiveTo === null || new Date(price.effectiveTo) >= now),
            )
            .sort((left, right) => {
               const leftExact = left.siteId === siteId ? 1 : 0;
               const rightExact = right.siteId === siteId ? 1 : 0;
               if (leftExact !== rightExact) return rightExact - leftExact;
               return new Date(right.effectiveFrom).getTime() - new Date(left.effectiveFrom).getTime();
            })
            .at(0) ?? null
      );
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
         lines: current.lines.some((line) => line.productId === "")
            ? current.lines.map((line) => (line.productId === "" ? { ...line, productId } : line))
            : [...current.lines, { ...blankPrescriptionLineValues(), productId }],
      }));
      setSearchQuery("");
   }

   function removeLine(productId: string) {
      setValues((current) => ({
         ...current,
         lines: current.lines.filter((line) => line.productId !== productId),
      }));
   }

   function updateLineQuantity(productId: string, prescribedQuantity: string) {
      setValues((current) => ({
         ...current,
         lines: current.lines.map((line) => (line.productId === productId ? { ...line, prescribedQuantity } : line)),
      }));
   }

   function validate() {
      if (!hasSaleSource) {
         return t("counterSale.validationHeader");
      }
      if (filledLines.length === 0) {
         return t("counterSale.validationLinesRequired");
      }
      const invalidLine = filledLines.findIndex(
         (line) => Number(line.prescribedQuantity) <= 0 || Number.isNaN(Number(line.prescribedQuantity)),
      );
      return invalidLine >= 0 ? t("counterSale.validationLine", { line: invalidLine + 1 }) : null;
   }

   async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (isSaving || !isDirty) return;
      const error = validate();
      setValidationError(error);
      if (error !== null) return;
      await onSubmit(values);
      setBaselineValues(values);
   }

   const missingPriceCount = values.lines.filter(
      (line) =>
         line.productId !== "" && values.siteId !== "" && computeActivePrice(line.productId, values.siteId) === null,
   ).length;

   return (
      <form className={styles.builder} onSubmit={handleSubmit}>
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         <Card className={`${styles.sourceCard}${!hasSaleSource ? ` ${styles.sourceMissing}` : ""}`}>
            <CardContent className={styles.sourceContent}>
               {hasSaleSource ? (
                  <>
                     <span className={styles.sourceLabel}>{t("counterSale.sourceLabel")}</span>
                     <span className={styles.sourceValue}>
                        {t("counterSale.saleSource", { site: saleSourceSite.name, location: saleSourceLocation.name })}
                     </span>
                  </>
               ) : (
                  <>
                     <span className={styles.sourceLabel}>{t("counterSale.sourceMissing")}</span>
                     <span className={styles.sourceValue}>{t("counterSale.sourceMissingDesc")}</span>
                  </>
               )}
            </CardContent>
         </Card>

         <Command className={styles.productCommand} shouldFilter={false}>
            <CommandInput
               value={searchQuery}
               onValueChange={setSearchQuery}
               placeholder={t("counterSale.searchProduct")}
               disabled={!hasSaleSource}
            />
            <CommandList className={styles.productCommandList}>
               {searchQuery.trim() !== "" ? <CommandEmpty>{t("counterSale.noResults")}</CommandEmpty> : null}
               {filteredProducts.length > 0 ? (
                  <CommandGroup>
                     {filteredProducts.map((product) => {
                        const stockInfo = getProductStockInfo(product.id);
                        const alreadyAdded = isProductInTicket(product.id);
                        const activePrice = values.siteId ? computeActivePrice(product.id, values.siteId) : null;
                        return (
                           <CommandItem
                              key={product.id}
                              value={`${product.name} ${product.sku}`}
                              disabled={alreadyAdded}
                              onSelect={() => addProductToTicket(product.id)}
                              className={styles.productCommandItem}
                           >
                              <div className={styles.productResultMain}>
                                 <span className={styles.productResultName}>{product.name}</span>
                                 <span className={styles.productResultSku}>{product.sku}</span>
                              </div>
                              <div className={styles.productResultMeta}>
                                 <Badge variant={stockInfo.totalAvailable > 0 ? "secondary" : "destructive"}>
                                    {stockInfo.totalAvailable > 0
                                       ? t("counterSale.available", { quantity: String(stockInfo.totalAvailable) })
                                       : t("counterSale.outOfStock")}
                                 </Badge>
                                 {stockInfo.bestBatch !== null ? (
                                    <span className={styles.productResultBatch}>
                                       {t("counterSale.batchInfo", {
                                          batchNumber: stockInfo.bestBatch.batchNumber,
                                          expiryDate: new Date(stockInfo.bestBatch.expiryDate).toLocaleDateString(),
                                       })}
                                    </span>
                                 ) : null}
                                 <Badge variant={activePrice !== null ? "outline" : "destructive"}>
                                    {activePrice !== null
                                       ? formatPrice(activePrice.unitPrice, activePrice.currency)
                                       : t("counterSale.noPrice")}
                                 </Badge>
                              </div>
                           </CommandItem>
                        );
                     })}
                  </CommandGroup>
               ) : null}
            </CommandList>
         </Command>

         <Card className={styles.linesCard}>
            <CardContent className={styles.linesContent}>
               <div className={styles.linesHeader}>
                  <div>
                     <h3>{t("counterSale.ticketLines")}</h3>
                     <p>{t("counterSale.ticketLinesDesc")}</p>
                  </div>
                  <Badge variant={filledLines.length > 0 ? "secondary" : "outline"}>{filledLines.length}</Badge>
               </div>

               {filledLines.length > 0 ? (
                  <MotionList className={styles.lines}>
                     {filledLines.map((line) => {
                        const product = productMap.get(line.productId);
                        const stockInfo = product !== undefined ? getProductStockInfo(product.id) : null;
                        const activePrice =
                           product !== undefined && values.siteId
                              ? computeActivePrice(product.id, values.siteId)
                              : null;
                        return (
                           <MotionListItem key={line.productId} className={styles.line}>
                              <div className={styles.lineInfo}>
                                 <span className={styles.lineName}>
                                    {product?.name ?? t("counterSale.unknownProduct")}
                                 </span>
                                 <div className={styles.lineMetaRow}>
                                    {stockInfo !== null && stockInfo.bestBatch !== null ? (
                                       <Badge variant="outline">
                                          {t("counterSale.batchInfo", {
                                             batchNumber: stockInfo.bestBatch.batchNumber,
                                             expiryDate: new Date(stockInfo.bestBatch.expiryDate).toLocaleDateString(),
                                          })}
                                       </Badge>
                                    ) : null}
                                    <Badge
                                       variant={
                                          stockInfo !== null && stockInfo.totalAvailable > 0
                                             ? "secondary"
                                             : "destructive"
                                       }
                                    >
                                       {stockInfo !== null && stockInfo.totalAvailable > 0
                                          ? t("counterSale.available", { quantity: String(stockInfo.totalAvailable) })
                                          : t("counterSale.outOfStock")}
                                    </Badge>
                                    <Badge variant={activePrice !== null ? "outline" : "destructive"}>
                                       {activePrice !== null
                                          ? formatPrice(activePrice.unitPrice, activePrice.currency)
                                          : t("counterSale.noPrice")}
                                    </Badge>
                                 </div>
                              </div>
                              <div className={styles.lineControls}>
                                 <Input
                                    className={styles.lineQty}
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    placeholder={t("counterSale.quantityLabel")}
                                    value={line.prescribedQuantity}
                                    onChange={(event) => updateLineQuantity(line.productId, event.target.value)}
                                 />
                                 <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => removeLine(line.productId)}
                                    aria-label={t("counterSale.removeLine")}
                                 >
                                    ×
                                 </Button>
                              </div>
                           </MotionListItem>
                        );
                     })}
                  </MotionList>
               ) : (
                  <div className={styles.emptyTicket}>{t("counterSale.ticketLinesDesc")}</div>
               )}
            </CardContent>
         </Card>

         <details
            className={styles.customerSection}
            open={customerExpanded}
            onToggle={(event) => setCustomerExpanded((event.target as HTMLDetailsElement).open)}
         >
            <summary className={styles.customerSummary}>
               {t("counterSale.customerInfo")}
               <span className={styles.customerSummaryIcon}>
                  <span className={styles.expandIcon} aria-hidden="true">
                     +
                  </span>
                  <span className={styles.collapseIcon} aria-hidden="true">
                     -
                  </span>
               </span>
            </summary>
            <div className={styles.customerFields}>
               <div className={styles.customerField}>
                  <Label htmlFor="counter-sale-patient">{t("prescription.patient")}</Label>
                  <Input
                     id="counter-sale-patient"
                     value={values.patientName}
                     onChange={(event) => setValues((current) => ({ ...current, patientName: event.target.value }))}
                  />
               </div>
               <div className={styles.customerField}>
                  <Label htmlFor="counter-sale-phone">{t("prescription.patientPhone")}</Label>
                  <Input
                     id="counter-sale-phone"
                     value={values.patientPhone ?? ""}
                     onChange={(event) => setValues((current) => ({ ...current, patientPhone: event.target.value }))}
                  />
               </div>
               <div className={`${styles.customerField} ${styles.customerFieldWide}`}>
                  <Label htmlFor="counter-sale-notes">{t("forms.notes")}</Label>
                  <Textarea
                     id="counter-sale-notes"
                     rows={2}
                     value={values.notes ?? ""}
                     onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                  />
               </div>
            </div>
         </details>

         <div className={styles.priceNote}>
            {missingPriceCount > 0
               ? t("counterSale.missingPriceWarning", { count: String(missingPriceCount) })
               : t("counterSale.priceAtPaymentNote")}
         </div>

         <div className="form-actions">
            <Button type="submit" disabled={isSaving || !isDirty || !hasSaleSource}>
               {isSaving ? t("common.saving") : t("counterSale.createButton")}
            </Button>
            <Button
               type="button"
               variant="outline"
               onClick={() => {
                  setValues(baselineValues);
                  setValidationError(null);
               }}
               disabled={isSaving || !isDirty}
            >
               {t("common.reset")}
            </Button>
         </div>
      </form>
   );
}
