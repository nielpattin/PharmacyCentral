import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import styles from "./PrescriptionDetail.module.css";
import { Badge } from "../../components/shadcn/badge";
import { Button } from "../../components/shadcn/button";
import { Card, CardContent, CardHeader } from "../../components/shadcn/card";
import { Input } from "../../components/shadcn/input";
import { EmptyState } from "../../components/ui/EmptyState";
import type {
   PrescriptionDetails,
   ProductDto,
   SiteDto,
   StorageLocationDto,
   InventoryBalanceDto,
} from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { areDispenseFormValuesEqual, type DispenseFormValues } from "../../pages/shared/prescriptionForms";

function prescriptionStatusVariant(status: string) {
   if (status === "Dispensed") return "secondary" as const;
   if (status === "Cancelled") return "destructive" as const;
   return "outline" as const;
}

type PrescriptionDetailProps = {
   prescription: PrescriptionDetails;
   isSaving: boolean;
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   balances: InventoryBalanceDto[];
   onDispense: (values: DispenseFormValues) => Promise<void>;
   onCancel: () => Promise<void>;
};

export function PrescriptionDetail({
   prescription,
   isSaving,
   products,
   sites,
   storageLocations,
   balances,
   onDispense,
   onCancel,
}: PrescriptionDetailProps) {
   const t = useT();
   const initialDispenseValues: DispenseFormValues = {
      lines: prescription.lines.map((line) => ({
         prescriptionLineId: line.id,
         productBatchId: line.productBatchId ?? "",
         dispensedQuantity: String(line.prescribedQuantity - line.dispensedQuantity),
      })),
   };
   const [dispenseValues, setDispenseValues] = useState(initialDispenseValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areDispenseFormValuesEqual(dispenseValues, initialDispenseValues);
   const canDispense = prescription.status === "Pending";
   const canCancel = prescription.status === "Draft" || prescription.status === "Pending";
   const hasActions = canDispense || canCancel;
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? t("counterSale.unknownSite");
   const locationName = (locationId: string) =>
      storageLocations.find((location) => location.id === locationId)?.name ?? t("counterSale.unknownLocation");
   const productName = (productId: string) =>
      products.find((product) => product.id === productId)?.name ?? t("counterSale.unknownProduct");
   const batchOptions = (productId: string) => {
      const seen = new Set<string>();
      return balances
         .filter(
            (balance) =>
               balance.productId === productId &&
               balance.siteId === prescription.siteId &&
               balance.storageLocationId === prescription.storageLocationId &&
               balance.quantityOnHand - balance.quantityReserved > 0,
         )
         .filter((balance) => {
            const key = `${balance.productBatchId}|${balance.storageLocationId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
         })
         .map((balance) => ({
            productBatchId: balance.productBatchId,
            storageLocationId: balance.storageLocationId,
            batchNumber: balance.batchNumber,
            expiryDate: balance.expiryDate,
            available: balance.quantityOnHand - balance.quantityReserved,
         }));
   };

   function validateDispense() {
      const invalidLine = dispenseValues.lines.findIndex(
         (line) =>
            line.productBatchId.trim() === "" ||
            Number(line.dispensedQuantity) <= 0 ||
            Number.isNaN(Number(line.dispensedQuantity)),
      );
      return invalidLine >= 0 ? t("prescription.validationDispenseLine", { line: invalidLine + 1 }) : null;
   }

   function updateLine(lineId: string, updates: Partial<(typeof dispenseValues.lines)[number]>) {
      setDispenseValues((current) => ({
         lines: current.lines.map((item) => (item.prescriptionLineId === lineId ? { ...item, ...updates } : item)),
      }));
   }

   return (
      <Card className={styles.ticket}>
         <CardHeader className={styles.ticketHeader}>
            <div className={styles.ticketInfo}>
               <h3 className={styles.ticketNumber}>{prescription.prescriptionNumber}</h3>
               <p className={styles.ticketPatient}>{prescription.patientName}</p>
               <p className={styles.ticketMeta}>
                  {siteName(prescription.siteId)} · {locationName(prescription.storageLocationId)}
               </p>
               <p className={styles.ticketMeta}>{new Date(prescription.createdAtUtc).toLocaleString()}</p>
            </div>
            <Badge variant={prescriptionStatusVariant(prescription.status)}>
               {t(`prescription.status.${prescription.status}`)}
            </Badge>
         </CardHeader>

         <CardContent className={styles.ticketLines}>
            <AnimatePresence mode="popLayout">
               {prescription.lines.map((line, index) => {
                  const value = dispenseValues.lines.find((item) => item.prescriptionLineId === line.id);
                  return (
                     <motion.div
                        key={line.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.14, delay: index * 0.02, ease: [0.2, 0, 0, 1] }}
                        className={styles.medicineCard}
                     >
                        <div className={styles.medicineCardHeader}>
                           <span className={styles.medicineProduct}>{productName(line.productId)}</span>
                           <Badge variant="outline">
                              {t("prescription.prescribedQuantity")} {line.prescribedQuantity}
                           </Badge>
                        </div>
                        {line.dosage !== null || line.frequency !== null || line.duration !== null ? (
                           <div className={styles.medicineDetails}>
                              {line.dosage !== null ? <span>{line.dosage}</span> : null}
                              {line.frequency !== null ? <span>{line.frequency}</span> : null}
                              {line.duration !== null ? <span>{line.duration}</span> : null}
                           </div>
                        ) : null}
                        {!canDispense ? (
                           <div className={styles.medicineDispensedInfo}>
                              {t("prescription.dispensedQuantity")}: {line.dispensedQuantity}
                           </div>
                        ) : null}

                        {canDispense && value !== undefined ? (
                           <div className={styles.medicineDispenseControls}>
                              <div className={styles.batchField}>
                                 <label className={styles.medicineLabel}>{t("prescription.batch")}</label>
                                 <select
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                                    value={value.productBatchId}
                                    onChange={(event) => updateLine(line.id, { productBatchId: event.target.value })}
                                 >
                                    <option value="">{t("prescription.selectBatch")}</option>
                                    {batchOptions(line.productId).map((option, optionIndex) => (
                                       <option
                                          key={`${option.productBatchId}-${option.storageLocationId}-${optionIndex}`}
                                          value={option.productBatchId}
                                       >
                                          {t("prescription.batchOption", {
                                             batchNumber: option.batchNumber,
                                             expiryDate: new Date(option.expiryDate).toLocaleDateString(),
                                             available: option.available,
                                          })}
                                       </option>
                                    ))}
                                 </select>
                              </div>
                              <div className={styles.qtyField}>
                                 <label className={styles.medicineLabel}>{t("prescription.dispensedQuantity")}</label>
                                 <Input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={value.dispensedQuantity}
                                    onChange={(event) => updateLine(line.id, { dispensedQuantity: event.target.value })}
                                 />
                              </div>
                           </div>
                        ) : null}
                     </motion.div>
                  );
               })}
            </AnimatePresence>
         </CardContent>

         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         {hasActions ? (
            <div className={styles.ticketActions}>
               <div className={styles.ticketActionsLeft}>
                  {canCancel ? (
                     <Button
                        variant="destructive"
                        onClick={async () => {
                           setValidationError(null);
                           await onCancel();
                        }}
                        disabled={isSaving}
                     >
                        {t("prescription.cancel")}
                     </Button>
                  ) : null}
               </div>
               <div className={styles.ticketActionsRight}>
                  {canDispense ? (
                     <>
                        <Button
                           variant="outline"
                           onClick={() => {
                              setDispenseValues(initialDispenseValues);
                              setValidationError(null);
                           }}
                           disabled={isSaving || !isDirty}
                        >
                           {t("common.reset")}
                        </Button>
                        <Button
                           onClick={async () => {
                              if (isSaving) return;
                              const error = validateDispense();
                              setValidationError(error);
                              if (error !== null) return;
                              await onDispense(dispenseValues);
                           }}
                           disabled={isSaving}
                        >
                           {t("prescription.dispense")}
                        </Button>
                     </>
                  ) : null}
               </div>
            </div>
         ) : (
            <EmptyState icon="✓" title={t("prescription.noActions")} description={t("prescription.noActionsDesc")} />
         )}
      </Card>
   );
}
