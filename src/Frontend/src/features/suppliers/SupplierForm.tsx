import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { useT } from "../../lib/i18n";
import { areSupplierFormValuesEqual, type SupplierFormValues } from "../../pages/shared/pharmacyForms";

type SupplierFormProps = {
   mode: "create" | "edit";
   initialValues: SupplierFormValues;
   isSaving: boolean;
   onSubmit: (values: SupplierFormValues) => Promise<void>;
   onDelete?: () => Promise<void>;
};

export function SupplierForm({ mode, initialValues, isSaving, onSubmit, onDelete }: SupplierFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const isDirty = !areSupplierFormValuesEqual(values, baselineValues);

   return (
      <form
         className="entity-form"
         onSubmit={async (event) => {
            event.preventDefault();
            if (isSaving || !isDirty) {
               return;
            }

            await onSubmit(values);
            setBaselineValues(values);
         }}
      >
         <div className="form-grid">
            <Field label={t("forms.code")} required>
               <input className="field-input" required value={values.code} onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))} />
            </Field>

            <Field label={t("forms.name")} required>
               <input className="field-input" required value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />
            </Field>

            <Field label={t("forms.contactName")}>
               <input className="field-input" value={values.contactName} onChange={(event) => setValues((current) => ({ ...current, contactName: event.target.value }))} />
            </Field>

            <Field label={t("forms.email")}>
               <input className="field-input" type="email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} />
            </Field>

            <Field label={t("forms.phone")}>
               <input className="field-input" value={values.phone} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))} />
            </Field>

            <Field label={t("forms.status")}>
               <select className="field-input" value={values.status} onChange={(event) => setValues((current) => ({ ...current, status: event.target.value }))}>
                  <option value="Active">{t("forms.activeOption")}</option>
                  <option value="Inactive">{t("forms.inactiveOption")}</option>
               </select>
            </Field>

            <Field label={t("forms.address")} className="field-wide">
               <input className="field-input" value={values.address} onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))} />
            </Field>

            <Field label={t("forms.notes")} className="field-wide">
               <textarea className="field-input field-textarea" rows={4} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
            </Field>

            <label className="field field-inline">
               <span className="field-label">{t("forms.active")}</span>
               <input className="field-check" type="checkbox" checked={values.isActive} onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))} />
            </label>
         </div>

         <div className="form-actions">
            <Button variant="primary" type="submit" disabled={isSaving || !isDirty}>
               {isSaving ? t("suppliers.saving") : mode === "create" ? t("suppliers.createButton") : t("suppliers.saveButton")}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setValues(baselineValues)} disabled={isSaving || !isDirty}>
               {t("suppliers.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="danger" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("suppliers.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
