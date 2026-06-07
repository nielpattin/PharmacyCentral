import { useState } from "react";
import styles from "./PrescriptionDetail.module.css";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import type { PrescriptionDetails, ProductDto, SiteDto, StorageLocationDto, InventoryBalanceDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { areDispenseFormValuesEqual, type DispenseFormValues } from "../../pages/shared/prescriptionForms";

function prescriptionStatusTone(status: string) {
   if (status === "Draft") return "role";
   if (status === "Dispensed") return "ok";
   if (status === "Cancelled") return "bad";
   return "warn";
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

export function PrescriptionDetail({ prescription, isSaving, products, sites, storageLocations, balances, onDispense, onCancel }: PrescriptionDetailProps) {
   const t = useT();
   const initialDispenseValues: DispenseFormValues = { lines: prescription.lines.map((line) => ({ prescriptionLineId: line.id, productBatchId: line.productBatchId ?? "", dispensedQuantity: String(line.prescribedQuantity - line.dispensedQuantity) })) };
   const [dispenseValues, setDispenseValues] = useState(initialDispenseValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areDispenseFormValuesEqual(dispenseValues, initialDispenseValues);
   const canDispense = prescription.status === "Pending";
   const canCancel = prescription.status === "Draft" || prescription.status === "Pending";
   const hasActions = canDispense || canCancel;
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? t("counterSale.unknownSite");
   const locationName = (locationId: string) => storageLocations.find((location) => location.id === locationId)?.name ?? t("counterSale.unknownLocation");
   const productName = (productId: string) => products.find((product) => product.id === productId)?.name ?? t("counterSale.unknownProduct");
   const batchOptions = (productId: string) => {
      const seen = new Set<string>();
      return balances
         .filter((bal) => bal.productId === productId && bal.siteId === prescription.siteId && bal.storageLocationId === prescription.storageLocationId && (bal.quantityOnHand - bal.quantityReserved) > 0)
         .filter((bal) => {
            const key = `${bal.productBatchId}|${bal.storageLocationId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
         })
         .map((bal) => ({ productBatchId: bal.productBatchId, storageLocationId: bal.storageLocationId, batchNumber: bal.batchNumber, expiryDate: bal.expiryDate, available: bal.quantityOnHand - bal.quantityReserved }));
   };

   function validateDispense() {
      const invalidLine = dispenseValues.lines.findIndex((line) => line.productBatchId.trim() === "" || Number(line.dispensedQuantity) <= 0 || Number.isNaN(Number(line.dispensedQuantity)));
      return invalidLine >= 0 ? t("prescription.validationDispenseLine", { line: invalidLine + 1 }) : null;
   }

   function updateLine(lineId: string, updates: Partial<(typeof dispenseValues.lines)[number]>) {
      setDispenseValues((current) => ({
         lines: current.lines.map((item) => item.prescriptionLineId === lineId ? { ...item, ...updates } : item),
      }));
   }

   return (
      <div className={styles.ticket}>
         <div className={styles.ticketHeader}>
            <div className={styles.ticketInfo}>
               <h3 className={styles.ticketNumber}>{prescription.prescriptionNumber}</h3>
               <p className={styles.ticketPatient}>{prescription.patientName}</p>
               <p className={styles.ticketMeta}>{siteName(prescription.siteId)} · {locationName(prescription.storageLocationId)}</p>
               <p className={styles.ticketMeta}>{new Date(prescription.createdAtUtc).toLocaleString()}</p>
            </div>
            <Badge tone={prescriptionStatusTone(prescription.status)}>{t(`prescription.status.${prescription.status}`)}</Badge>
         </div>

         <div className={styles.ticketLines}>
            {prescription.lines.map((line) => {
               const value = dispenseValues.lines.find((item) => item.prescriptionLineId === line.id);
               return (
                  <div key={line.id} className={styles.medicineCard}>
                     <div className={styles.medicineCardHeader}>
                        <span className={styles.medicineProduct}>{productName(line.productId)}</span>
                        <span className={styles.medicinePrescribed}>{t("prescription.prescribedQuantity")} {line.prescribedQuantity}</span>
                     </div>
                     {(line.dosage !== null || line.frequency !== null || line.duration !== null) ? (
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
                              <select className="field-input" value={value.productBatchId} onChange={(event) => updateLine(line.id, { productBatchId: event.target.value })}>
                                 <option value="">{t("prescription.selectBatch")}</option>
                                 {batchOptions(line.productId).map((option, index) => (
                                    <option key={`${option.productBatchId}-${option.storageLocationId}-${index}`} value={option.productBatchId}>{t("prescription.batchOption", { batchNumber: option.batchNumber, expiryDate: new Date(option.expiryDate).toLocaleDateString(), available: option.available })}</option>
                                 ))}
                              </select>
                           </div>
                           <div className={styles.qtyField}>
                              <label className={styles.medicineLabel}>{t("prescription.dispensedQuantity")}</label>
                              <input className="field-input" type="number" min="0.01" step="0.01" value={value.dispensedQuantity} onChange={(event) => updateLine(line.id, { dispensedQuantity: event.target.value })} />
                           </div>
                        </div>
                     ) : null}
                  </div>
               );
            })}
         </div>

         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         {hasActions ? (
            <div className={styles.ticketActions}>
               <div className={styles.ticketActionsLeft}>
                  {canCancel ? <Button variant="danger" onClick={async () => { setValidationError(null); await onCancel(); }} disabled={isSaving}>{t("prescription.cancel")}</Button> : null}
               </div>
               <div className={styles.ticketActionsRight}>
                  {canDispense ? (
                     <>
                        <Button variant="secondary" onClick={() => { setDispenseValues(initialDispenseValues); setValidationError(null); }} disabled={isSaving || !isDirty}>{t("common.reset")}</Button>
                        <Button variant="primary" onClick={async () => { if (isSaving) return; const error = validateDispense(); setValidationError(error); if (error !== null) return; await onDispense(dispenseValues); }} disabled={isSaving}>{t("prescription.dispense")}</Button>
                     </>
                  ) : null}
               </div>
            </div>
         ) : (
            <EmptyState icon="✓" title={t("prescription.noActions")} description={t("prescription.noActionsDesc")} />
         )}
      </div>
   );
}
