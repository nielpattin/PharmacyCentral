import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { useT } from "../../lib/i18n";
import { normalizeSiteTypeValue, siteTypeLabel, siteTypeOptions } from "../../pages/shared/pharmacyTypes";
import { areSiteFormValuesEqual, type SiteFormValues } from "../../pages/shared/pharmacyForms";

type SiteFormProps = {
   mode: "create" | "edit";
   initialValues: SiteFormValues;
   isSaving: boolean;
   onSubmit: (values: SiteFormValues) => Promise<void>;
   onDelete?: () => Promise<void>;
};

export function SiteForm({ mode, initialValues, isSaving, onSubmit, onDelete }: SiteFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const isDirty = !areSiteFormValuesEqual(values, baselineValues);

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
               <input
                  className="field-input"
                  required
                  value={values.code}
                  onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))}
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

            <Field label={t("forms.type")} required>
               <select
                  className="field-input"
                  required
                  value={normalizeSiteTypeValue(values.siteType)}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        siteType: event.target.value as SiteFormValues["siteType"],
                     }))
                  }
               >
                  <option value="">{t("forms.selectType")}</option>
                  {siteTypeOptions.map((type) => (
                     <option key={type} value={type}>
                        {siteTypeLabel(type, t)}
                     </option>
                  ))}
               </select>
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

            <Field label={t("forms.address")}>
               <input
                  className="field-input"
                  value={values.address}
                  onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))}
               />
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
               {isSaving ? t("sites.saving") : mode === "create" ? t("sites.createButton") : t("sites.saveButton")}
            </Button>
            <Button
               variant="secondary"
               type="button"
               onClick={() => setValues(baselineValues)}
               disabled={isSaving || !isDirty}
            >
               {t("sites.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="danger" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("sites.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
