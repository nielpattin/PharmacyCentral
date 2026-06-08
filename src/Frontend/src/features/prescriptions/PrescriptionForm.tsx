import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import styles from "./PrescriptionForm.module.css";
import { Badge } from "../../components/shadcn/badge";
import { Button } from "../../components/shadcn/button";
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
import { MotionList, MotionListItem } from "../../components/motion/MotionList";
import type {
   ProductDto,
   ProductPriceDto,
   SiteDto,
   StorageLocationDto,
   InventoryBalanceDto,
} from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { MedicineInfoModal } from "./MedicineInfoModal";
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
   headerAction?: React.ReactNode;
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
   headerAction,
   onSubmit,
}: PrescriptionFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const [searchQuery, setSearchQuery] = useState("");
   const [selectedInfoProductId, setSelectedInfoProductId] = useState<string | null>(null);
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
      return products
         .filter(
            (p) =>
               p.name.toLowerCase().includes(q) ||
               p.sku.toLowerCase().includes(q) ||
               (p.barcode?.toLowerCase().includes(q) ?? false),
         )
         .slice(0, 20);
   }, [hasSaleSource, products, searchQuery]);

   const productMap = useMemo(() => {
      const map = new Map<string, ProductDto>();
      for (const product of products) {
         map.set(product.id, product);
      }
      return map;
   }, [products]);

   const filledLines = useMemo(() => values.lines.filter((line) => line.productId !== ""), [values.lines]);
   const quickProducts = useMemo(() => {
      if (!hasSaleSource) return [];
      return products
         .filter((product) =>
            balances.some(
               (balance) =>
                  balance.productId === product.id &&
                  balance.siteId === values.siteId &&
                  balance.storageLocationId === values.storageLocationId &&
                  balance.quantityOnHand - balance.quantityReserved > 0,
            ),
         )
         .slice(0, 8);
   }, [balances, hasSaleSource, products, values.siteId, values.storageLocationId]);
   const visibleProducts = searchQuery.trim() === "" ? quickProducts : filteredProducts;

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

   function computeActivePrice(productId: string, productUnitId: string, siteId: string) {
      const now = new Date();
      return (
         prices
            .filter(
               (price) =>
                  price.productId === productId &&
                  price.productUnitId === productUnitId &&
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
      const product = productMap.get(productId);
      const productUnitId = product?.units.find((unit) => unit.isDefaultSaleUnit)?.id ?? product?.units[0]?.id ?? "";
      setValues((current) => ({
         ...current,
         lines: current.lines.some((line) => line.productId === "")
            ? current.lines.map((line) => (line.productId === "" ? { ...line, productId, productUnitId, prescribedQuantity: "1" } : line))
            : [...current.lines, { ...blankPrescriptionLineValues(), productId, productUnitId, prescribedQuantity: "1" }],
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

   function adjustLineQuantity(productId: string, delta: number) {
      setValues((current) => ({
         ...current,
         lines: current.lines.map((line) => {
            if (line.productId !== productId) return line;

            const currentQuantity = Number(line.prescribedQuantity);
            const nextQuantity = Math.max(1, (Number.isInteger(currentQuantity) ? currentQuantity : 1) + delta);
            return { ...line, prescribedQuantity: String(nextQuantity) };
         }),
      }));
   }

   function validate() {
      if (!hasSaleSource) {
         return t("counterSale.validationHeader");
      }
      if (filledLines.length === 0) {
         return t("counterSale.validationLinesRequired");
      }
      const invalidLine = filledLines.findIndex((line) => {
         const quantity = Number(line.prescribedQuantity);
         return !Number.isInteger(quantity) || quantity <= 0;
      });
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

   const selectedInfoProduct = selectedInfoProductId === null ? null : (productMap.get(selectedInfoProductId) ?? null);
   const selectedInfoLine =
      selectedInfoProductId === null ? null : (values.lines.find((line) => line.productId === selectedInfoProductId) ?? null);
   const selectedInfoBalances =
      selectedInfoProductId === null
         ? []
         : balances.filter(
              (balance) =>
                 balance.productId === selectedInfoProductId &&
                 balance.siteId === values.siteId &&
                 balance.storageLocationId === values.storageLocationId,
           );
   const selectedInfoPrice =
      selectedInfoProductId !== null && selectedInfoLine !== null && values.siteId !== "" ? computeActivePrice(selectedInfoProductId, selectedInfoLine.productUnitId, values.siteId) : null;
   const selectedInfoInstructions =
      selectedInfoLine === null
         ? []
         : [selectedInfoLine.dosage, selectedInfoLine.frequency, selectedInfoLine.duration, selectedInfoLine.notes].filter(
              (item): item is string => item !== null && item.trim() !== "",
           );
   const summaryTotalAmount = filledLines.reduce((sum, line) => {
      if (values.siteId === "") return sum;
      const activePrice = computeActivePrice(line.productId, line.productUnitId, values.siteId);
      return sum + (activePrice?.unitPrice ?? 0) * (Number(line.prescribedQuantity) || 0);
   }, 0);
   const summaryCurrency =
      filledLines
         .map((line) => (values.siteId === "" ? null : computeActivePrice(line.productId, line.productUnitId, values.siteId)))
         .find((price): price is ProductPriceDto => price !== null)?.currency ?? "VND";

   return (
      <form className={styles.builder} onSubmit={handleSubmit}>
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         <div className={styles.posHeader}>
            <div className={styles.posHeaderContext}>
               <div className={`${styles.sourceChip}${!hasSaleSource ? ` ${styles.sourceMissing}` : ""}`}>
                  {hasSaleSource ? (
                     <strong>
                        {t("counterSale.saleSource", { site: saleSourceSite.name, location: saleSourceLocation.name })}
                     </strong>
                  ) : (
                     <strong>{t("counterSale.sourceMissing")}</strong>
                  )}
               </div>
               {headerAction !== undefined ? <div className={styles.headerAction}>{headerAction}</div> : null}
            </div>
         </div>

         <div className={styles.posLayout}>
            <section className={styles.discoveryPanel} aria-label={t("counterSale.productFinderTitle")}>
               <div className={styles.finderSurface}>
                  <div className={styles.finderHeader}>
                     <h3>{t("counterSale.scanLabel")}</h3>
                  </div>

                  <Command className={styles.productCommand} shouldFilter={false}>
                     <CommandInput
                        value={searchQuery}
                        onValueChange={setSearchQuery}
                        placeholder={t("counterSale.unifiedSearchPlaceholder")}
                        disabled={!hasSaleSource}
                     />
                     <CommandList className={styles.productCommandList}>
                        {searchQuery.trim() === "" && visibleProducts.length === 0 ? (
                           <div className={styles.discoveryEmpty}>
                              <strong>{t("counterSale.discoveryEmptyTitle")}</strong>
                           </div>
                        ) : null}
                        {searchQuery.trim() !== "" && visibleProducts.length === 0 ? (
                           <CommandEmpty>{t("counterSale.noResults")}</CommandEmpty>
                        ) : null}
                        {visibleProducts.length > 0 ? (
                           <CommandGroup
                              heading={searchQuery.trim() === "" ? t("counterSale.quickAdd") : t("counterSale.searchResults")}
                           >
                              {visibleProducts.map((product) => {
                                 const stockInfo = getProductStockInfo(product.id);
                                 const alreadyAdded = isProductInTicket(product.id);
                                 const defaultUnitId = product.units.find((unit) => unit.isDefaultSaleUnit)?.id ?? product.units[0]?.id ?? "";
                                 const activePrice = values.siteId ? computeActivePrice(product.id, defaultUnitId, values.siteId) : null;
                                 return (
                                    <CommandItem
                                       key={product.id}
                                       value={`${product.name} ${product.sku}`}
                                       onSelect={() => {
                                          if (!alreadyAdded && stockInfo.totalAvailable > 0) {
                                             addProductToTicket(product.id);
                                          }
                                       }}
                                       className={styles.productRow}
                                    >
                                       <div className={styles.productResultMain}>
                                          <span className={styles.productResultName}>{product.name}</span>
                                          <span className={styles.productResultSku}>
                                             {product.sku}
                                             {product.barcode !== null ? ` · ${product.barcode}` : ""}
                                          </span>
                                       </div>
                                       {searchQuery.trim() !== "" ? (
                                          <div className={styles.productResultMeta}>
                                             <Badge variant={stockInfo.totalAvailable > 0 ? "secondary" : "destructive"}>
                                                {stockInfo.totalAvailable > 0
                                                   ? t("counterSale.available", { quantity: String(stockInfo.totalAvailable) })
                                                   : t("counterSale.outOfStock")}
                                             </Badge>
                                             <Badge variant={activePrice !== null ? "outline" : "destructive"}>
                                                {activePrice !== null
                                                   ? formatPrice(activePrice.unitPrice, activePrice.currency)
                                                   : t("counterSale.noPrice")}
                                             </Badge>
                                          </div>
                                       ) : null}
                                       <div className={styles.productActions}>
                                          <Button
                                             type="button"
                                             variant="outline"
                                             size="sm"
                                             onClick={(event) => {
                                                event.stopPropagation();
                                                setSelectedInfoProductId(product.id);
                                             }}
                                          >
                                             <Info size={14} aria-hidden="true" />
                                             {t("counterSale.infoButton")}
                                          </Button>
                                          <Button
                                             type="button"
                                             size="sm"
                                             disabled={alreadyAdded || stockInfo.totalAvailable <= 0}
                                             onClick={(event) => {
                                                event.stopPropagation();
                                                addProductToTicket(product.id);
                                             }}
                                          >
                                             {alreadyAdded ? t("counterSale.alreadyAdded") : t("counterSale.addProduct")}
                                          </Button>
                                       </div>
                                    </CommandItem>
                                 );
                              })}
                           </CommandGroup>
                        ) : null}
                     </CommandList>
                  </Command>
               </div>
            </section>

            <aside className={styles.transactionPanel} aria-label={t("counterSale.currentTransaction")}>
               <div className={styles.transactionHeader}>
                  <h3>{t("counterSale.currentTransaction")}</h3>
                  <Badge variant={filledLines.length > 0 ? "secondary" : "outline"}>{filledLines.length}</Badge>
               </div>

               <div className={styles.transactionMain}>
               <section className={styles.customerSection} aria-label={t("counterSale.customerInfo")}>
                  <h4>{t("counterSale.customerInfo")}</h4>
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
                  </div>
               </section>



               <div className={styles.cartBody}>
                  {filledLines.length > 0 ? (
                     <MotionList className={styles.lines}>
                        {filledLines.map((line) => {
                           const product = productMap.get(line.productId);
                           const stockInfo = product !== undefined ? getProductStockInfo(product.id) : null;
                           const activePrice =
                              product !== undefined && values.siteId
                                 ? computeActivePrice(product.id, line.productUnitId, values.siteId)
                                 : null;
                           return (
                              <MotionListItem key={line.productId} className={styles.line}>
                                 <div className={styles.lineTop}>
                                    <div className={styles.lineInfo}>
                                       <span className={styles.lineName}>
                                          {product?.name ?? t("counterSale.unknownProduct")}
                                       </span>
                                       <div className={styles.lineSubMeta}>
                                          <span>{product?.sku ?? t("common.notAvailable")}</span>
                                          {product?.unit ? <span>{product.unit}</span> : null}
                                       </div>
                                    </div>
                                    <Button
                                       type="button"
                                       variant="ghost"
                                       size="icon-sm"
                                       className={styles.removeLineButton}
                                       onClick={() => removeLine(line.productId)}
                                       aria-label={t("counterSale.removeLine")}
                                    >
                                       ×
                                    </Button>
                                 </div>
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
                                 <div className={styles.lineControls}>
                                    <Button
                                       type="button"
                                       variant="outline"
                                       size="sm"
                                       onClick={() => setSelectedInfoProductId(line.productId)}
                                    >
                                       {t("counterSale.infoButton")}
                                    </Button>
                                    <div className={styles.quantityStepper} aria-label={t("counterSale.quantityLabel")}>
                                       <div className={styles.quantityAdjustGroup} aria-label={t("counterSale.decreaseQuantity")}>
                                          {[-10, -5, -1].map((delta) => (
                                             <Button
                                                key={delta}
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={`${styles.quantityStepButton} ${styles.quantityStepButtonDecrease}`}
                                                onClick={() => adjustLineQuantity(line.productId, delta)}
                                             >
                                                {delta}
                                             </Button>
                                          ))}
                                       </div>
                                       <label className={styles.quantityValueControl}>
                                          <span>SL</span>
                                          <Input
                                             className={styles.lineQty}
                                             type="number"
                                             min="1"
                                             step="1"
                                             inputMode="numeric"
                                             aria-label={t("counterSale.quantityLabel")}
                                             value={line.prescribedQuantity}
                                             onChange={(event) => updateLineQuantity(line.productId, event.target.value)}
                                          />
                                       </label>
                                       <div className={styles.quantityAdjustGroup} aria-label={t("counterSale.increaseQuantity")}>
                                          {[1, 5, 10].map((delta) => (
                                             <Button
                                                key={delta}
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={`${styles.quantityStepButton} ${styles.quantityStepButtonIncrease}`}
                                                onClick={() => adjustLineQuantity(line.productId, delta)}
                                             >
                                                +{delta}
                                             </Button>
                                          ))}
                                       </div>
                                    </div>
                                 </div>
                              </MotionListItem>
                           );
                        })}
                     </MotionList>
                  ) : (
                     <div className={styles.emptyTicket}>
                        <strong>{t("counterSale.emptyCartTitle")}</strong>
                     </div>
                  )}
               </div>
               </div>

               <div className={styles.checkoutFooter}>
                  <div className={styles.checkoutTotals}>
                     <span>{t("counterSale.totalAmount")}</span>
                     <strong>
                        {summaryTotalAmount.toLocaleString()} {summaryCurrency}
                     </strong>
                  </div>
                  <div className={styles.checkoutActions}>
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
               </div>


            </aside>
         </div>
         {selectedInfoProduct !== null ? (
            <MedicineInfoModal
               product={selectedInfoProduct}
               balances={selectedInfoBalances}
               activePrice={selectedInfoPrice}
               instructions={selectedInfoInstructions}
               onClose={() => setSelectedInfoProductId(null)}
            />
         ) : null}

      </form>
   );
}
