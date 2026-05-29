import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import type { PrescriptionDetails, ProductDto, SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
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
   onDispense: (values: DispenseFormValues) => Promise<void>;
   onCancel: () => Promise<void>;
};

export function PrescriptionDetail({ prescription, isSaving, products, sites, storageLocations, onDispense, onCancel }: PrescriptionDetailProps) {
   const t = useT();
   const initialDispenseValues: DispenseFormValues = { lines: prescription.lines.map((line) => ({ prescriptionLineId: line.id, productBatchId: line.productBatchId ?? "", dispensedQuantity: String(line.prescribedQuantity - line.dispensedQuantity) })) };
   const [dispenseValues, setDispenseValues] = useState(initialDispenseValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areDispenseFormValuesEqual(dispenseValues, initialDispenseValues);
   const canDispense = prescription.status === "Pending";
   const canCancel = prescription.status === "Draft" || prescription.status === "Pending";
   const hasActions = canDispense || canCancel;
   const siteName = (siteId: string) => sites.find((site) => site.id === siteId)?.name ?? siteId;
   const locationName = (locationId: string) => storageLocations.find((location) => location.id === locationId)?.name ?? locationId;
   const productName = (productId: string) => products.find((product) => product.id === productId)?.name ?? productId;

   function validateDispense() {
      const invalidLine = dispenseValues.lines.findIndex((line) => line.productBatchId.trim() === "" || Number(line.dispensedQuantity) <= 0 || Number.isNaN(Number(line.dispensedQuantity)));
      return invalidLine >= 0 ? t("prescription.validationDispenseLine", { line: invalidLine + 1 }) : null;
   }

   return (
      <div className="entity-form">
         <div className="section-header">
            <div><h3 className="section-title">{prescription.prescriptionNumber}</h3><p className="section-subtitle">{prescription.patientName} · {siteName(prescription.siteId)} · {locationName(prescription.storageLocationId)}</p></div>
            <Badge tone={prescriptionStatusTone(prescription.status)}>{t(`prescription.status.${prescription.status}`)}</Badge>
         </div>
         <p className="section-subtitle">{prescription.doctorName ?? ""}{prescription.doctorLicense ? ` · ${prescription.doctorLicense}` : ""}</p>
         <p className="section-subtitle">{new Date(prescription.createdAtUtc).toLocaleString()}</p>

         <div className="table-wrap"><table className="selectable-table sites-table"><thead><tr><th>{t("prescription.product")}</th><th>{t("prescription.prescribedQuantity")}</th><th>{t("prescription.dispensedQuantity")}</th><th>{t("prescription.dosage")}</th><th>{t("prescription.frequency")}</th><th>{t("prescription.duration")}</th><th>{t("forms.notes")}</th></tr></thead><tbody>{prescription.lines.map((line) => <tr key={line.id}><td>{productName(line.productId)}</td><td>{line.prescribedQuantity}</td><td>{line.dispensedQuantity}</td><td>{line.dosage ?? ""}</td><td>{line.frequency ?? ""}</td><td>{line.duration ?? ""}</td><td>{line.notes ?? ""}</td></tr>)}</tbody></table></div>

         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}

         {canDispense ? (
            <form onSubmit={async (event) => { event.preventDefault(); if (isSaving) return; const error = validateDispense(); setValidationError(error); if (error !== null) return; await onDispense(dispenseValues); }}>
               <div className="section-header"><div><h3 className="section-title">{t("prescription.dispense")}</h3><p className="section-subtitle">{t("prescription.dispenseDesc")}</p></div></div>
               <div className="table-wrap"><table className="selectable-table sites-table"><thead><tr><th>{t("prescription.product")}</th><th>{t("prescription.prescribedQuantity")}</th><th>{t("prescription.batch")}</th><th>{t("prescription.dispensedQuantity")}</th></tr></thead><tbody>{prescription.lines.map((line) => { const value = dispenseValues.lines.find((item) => item.prescriptionLineId === line.id); return <tr key={line.id}><td>{productName(line.productId)}</td><td>{line.prescribedQuantity}</td><td><input className="field-input" required value={value?.productBatchId ?? ""} onChange={(event) => setDispenseValues((current) => ({ lines: current.lines.map((item) => item.prescriptionLineId === line.id ? { ...item, productBatchId: event.target.value } : item) }))} /></td><td><input className="field-input" required type="number" min="0.01" step="0.01" value={value?.dispensedQuantity ?? ""} onChange={(event) => setDispenseValues((current) => ({ lines: current.lines.map((item) => item.prescriptionLineId === line.id ? { ...item, dispensedQuantity: event.target.value } : item) }))} /></td></tr>; })}</tbody></table></div>
               <div className="form-actions"><Button variant="primary" type="submit" disabled={isSaving}>{t("prescription.dispense")}</Button><Button variant="secondary" onClick={() => { setDispenseValues(initialDispenseValues); setValidationError(null); }} disabled={isSaving || !isDirty}>{t("common.reset")}</Button></div>
            </form>
         ) : null}

         {canCancel ? <div className="section-header"><div><h3 className="section-title">{t("prescription.cancel")}</h3><p className="section-subtitle">{t("prescription.cancelDesc")}</p></div><Button variant="danger" onClick={async () => { setValidationError(null); await onCancel(); }} disabled={isSaving}>{t("prescription.cancel")}</Button></div> : null}
         {!hasActions ? <EmptyState icon="✓" title={t("prescription.noActions")} description={t("prescription.noActionsDesc")} /> : null}
      </div>
   );
}
