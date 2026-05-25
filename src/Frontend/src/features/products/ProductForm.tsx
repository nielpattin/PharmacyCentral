import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { useT } from "../../lib/i18n";
import { areProductFormValuesEqual, type ProductFormValues } from "../../pages/shared/pharmacyForms";

type ProductFormProps = {
   mode: "create" | "edit";
   initialValues: ProductFormValues;
   isSaving: boolean;
   onSubmit: (values: ProductFormValues) => Promise<void>;
   onDelete?: () => Promise<void>;
};

export function ProductForm({ mode, initialValues, isSaving, onSubmit, onDelete }: ProductFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const isDirty = !areProductFormValuesEqual(values, baselineValues);

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
            <Field label={t("forms.sku")} required>
               <input
                  className="field-input"
                  required
                  value={values.sku}
                  onChange={(event) => setValues((current) => ({ ...current, sku: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.name")} required>
               <input
                  className="field-input"
                  required
                  value={values.name}
                  onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.category")}>
               <input
                  className="field-input"
                  value={values.category}
                  onChange={(event) => setValues((current) => ({ ...current, category: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.unit")}>
               <input
                  className="field-input"
                  value={values.unit}
                  onChange={(event) => setValues((current) => ({ ...current, unit: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.manufacturer")}>
               <input
                  className="field-input"
                  value={values.manufacturer}
                  onChange={(event) => setValues((current) => ({ ...current, manufacturer: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.status")}>
               <select
                  className="field-input"
                  value={values.status}
                  onChange={(event) => setValues((current) => ({ ...current, status: event.target.value }))}
               >
                  <option value="Active">{t("forms.activeOption")}</option>
                  <option value="Inactive">{t("forms.inactiveOption")}</option>
               </select>
            </Field>

            <Field label={t("forms.notes")} className="field-wide">
               <textarea
                  className="field-input field-textarea"
                  rows={4}
                  value={values.notes}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
               />
            </Field>

            <label className="field field-inline">
               <span className="field-label">{t("forms.active")}</span>
               <input
                  className="field-check"
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
               />
            </label>
         </div>

         <div className="form-actions">
            <Button variant="primary" type="submit" disabled={isSaving || !isDirty}>
               {isSaving ? t("products.saving") : mode === "create" ? t("products.createButton") : t("products.saveButton")}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setValues(baselineValues)} disabled={isSaving || !isDirty}>
               {t("products.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="danger" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("products.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
