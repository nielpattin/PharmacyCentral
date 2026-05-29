import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import type { ProductDto, SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { arePrescriptionFormValuesEqual, blankPrescriptionLineValues, type PrescriptionFormValues } from "../../pages/shared/prescriptionForms";

type PrescriptionFormProps = {
   initialValues: PrescriptionFormValues;
   isSaving: boolean;
   products: ProductDto[];
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   onSubmit: (values: PrescriptionFormValues) => Promise<void>;
};

export function PrescriptionForm({ initialValues, isSaving, products, sites, storageLocations, onSubmit }: PrescriptionFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !arePrescriptionFormValuesEqual(values, baselineValues);

   const availableStorageLocations = useMemo(() => (values.siteId === "" ? storageLocations : storageLocations.filter((location) => location.siteId === values.siteId)), [storageLocations, values.siteId]);

   function validate() {
      if (values.siteId === "" || values.storageLocationId === "" || values.patientName.trim() === "") {
         return t("prescription.validationHeader");
      }

      if (values.lines.length === 0) {
         return t("prescription.validationLinesRequired");
      }

      const invalidLine = values.lines.findIndex((line) => line.productId === "" || Number(line.prescribedQuantity) <= 0 || Number.isNaN(Number(line.prescribedQuantity)));
      return invalidLine >= 0 ? t("prescription.validationLine", { line: invalidLine + 1 }) : null;
   }

   return (
      <form className="entity-form" onSubmit={async (event) => { event.preventDefault(); if (isSaving || !isDirty) return; const error = validate(); setValidationError(error); if (error !== null) return; await onSubmit(values); setBaselineValues(values); }}>
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}
         <div className="form-grid">
            <Field label={t("prescription.site")} required><select className="field-input" required value={values.siteId} onChange={(event) => setValues((current) => ({ ...current, siteId: event.target.value, storageLocationId: "" }))}><option value="">{t("forms.selectSite")}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
            <Field label={t("prescription.location")} required><select className="field-input" required value={values.storageLocationId} onChange={(event) => setValues((current) => ({ ...current, storageLocationId: event.target.value }))}><option value="">{t("prescription.selectLocation")}</option>{availableStorageLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <Field label={t("prescription.patient")} required><input className="field-input" required value={values.patientName} onChange={(event) => setValues((current) => ({ ...current, patientName: event.target.value }))} /></Field>
            <Field label={t("prescription.patientPhone")}><input className="field-input" value={values.patientPhone ?? ""} onChange={(event) => setValues((current) => ({ ...current, patientPhone: event.target.value }))} /></Field>
            <Field label={t("prescription.doctor")}><input className="field-input" value={values.doctorName ?? ""} onChange={(event) => setValues((current) => ({ ...current, doctorName: event.target.value }))} /></Field>
            <Field label={t("prescription.doctorLicense")}><input className="field-input" value={values.doctorLicense ?? ""} onChange={(event) => setValues((current) => ({ ...current, doctorLicense: event.target.value }))} /></Field>
            <Field label={t("forms.notes")} className="field-wide"><textarea className="field-input field-textarea" rows={3} value={values.notes ?? ""} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} /></Field>
         </div>

         <div className="section-header">
            <div><h3 className="section-title">{t("prescription.lines")}</h3><p className="section-subtitle">{t("prescription.linesDesc")}</p></div>
            <Button variant="secondary" size="sm" onClick={() => setValues((current) => ({ ...current, lines: [...current.lines, blankPrescriptionLineValues()] }))}>{t("prescription.addLine")}</Button>
         </div>

         {values.lines.map((line, index) => (
            <div className="form-grid" key={index}>
               <Field label={t("prescription.product")} required><select className="field-input" required value={line.productId} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item) }))}><option value="">{t("prescription.selectProduct")}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select></Field>
               <Field label={t("prescription.prescribedQuantity")} required><input className="field-input" required min="0.01" step="0.01" type="number" value={line.prescribedQuantity} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, prescribedQuantity: event.target.value } : item) }))} /></Field>
               <Field label={t("prescription.dosage")}><input className="field-input" value={line.dosage ?? ""} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, dosage: event.target.value } : item) }))} /></Field>
               <Field label={t("prescription.frequency")}><input className="field-input" value={line.frequency ?? ""} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, frequency: event.target.value } : item) }))} /></Field>
               <Field label={t("prescription.duration")}><input className="field-input" value={line.duration ?? ""} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, duration: event.target.value } : item) }))} /></Field>
               <Field label={t("forms.notes")}><input className="field-input" value={line.notes ?? ""} onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((item, itemIndex) => itemIndex === index ? { ...item, notes: event.target.value } : item) }))} /></Field>
               <div className="form-actions"><Button variant="danger" size="sm" onClick={() => setValues((current) => ({ ...current, lines: current.lines.filter((_, itemIndex) => itemIndex !== index) }))} disabled={isSaving || values.lines.length <= 1}>{t("prescription.removeLine")}</Button></div>
            </div>
         ))}

         <div className="form-actions"><Button variant="primary" type="submit" disabled={isSaving || !isDirty}>{isSaving ? t("common.saving") : t("prescription.createButton")}</Button><Button variant="secondary" onClick={() => { setValues(baselineValues); setValidationError(null); }} disabled={isSaving || !isDirty}>{t("common.reset")}</Button></div>
      </form>
   );
}
