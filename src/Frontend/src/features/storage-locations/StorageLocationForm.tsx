import { useState } from "react";
import { Button } from "../../components/shadcn/button";
import { Field } from "../../components/ui/Field";
import type { SiteDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import {
   normalizeStorageLocationTypeValue,
   storageLocationTypeLabel,
   storageLocationTypeOptions,
} from "../../pages/shared/pharmacyTypes";
import { areStorageLocationFormValuesEqual, type StorageLocationFormValues } from "../../pages/shared/pharmacyForms";

type StorageLocationFormProps = {
   mode: "create" | "edit";
   sites: SiteDto[];
   initialValues: StorageLocationFormValues;
   isSaving: boolean;
   onSubmit: (values: StorageLocationFormValues) => Promise<void>;
   onDelete?: () => Promise<void>;
};

export function StorageLocationForm({
   mode,
   sites,
   initialValues,
   isSaving,
   onSubmit,
   onDelete,
}: StorageLocationFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const isDirty = !areStorageLocationFormValuesEqual(values, baselineValues);

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
         <div className="section-header">
            <div>
               <h2 className="section-title">{mode === "create" ? t("storage.create") : t("storage.edit")}</h2>
               <p className="section-subtitle">{t("storage.link")}</p>
            </div>
            <span className="badge b-role">{mode === "create" ? t("status.new") : t("status.selected")}</span>
         </div>

         <div className="form-grid">
            <Field label={t("forms.site")} required>
               <select
                  className="field-input"
                  required
                  value={values.siteId}
                  onChange={(event) => setValues((current) => ({ ...current, siteId: event.target.value }))}
               >
                  <option value="">{t("forms.selectSite")}</option>
                  {sites.map((site) => (
                     <option key={site.id} value={site.id}>
                        {site.code} · {site.name}
                     </option>
                  ))}
               </select>
            </Field>

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
                  value={normalizeStorageLocationTypeValue(values.locationType)}
                  onChange={(event) =>
                     setValues((current) => ({
                        ...current,
                        locationType: event.target.value as StorageLocationFormValues["locationType"],
                     }))
                  }
               >
                  <option value="">{t("forms.selectType")}</option>
                  {storageLocationTypeOptions.map((type) => (
                     <option key={type} value={type}>
                        {storageLocationTypeLabel(type, t)}
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

            <Field label={t("forms.capacity")}>
               <input
                  className="field-input"
                  type="number"
                  step="0.01"
                  value={values.capacity}
                  onChange={(event) => setValues((current) => ({ ...current, capacity: event.target.value }))}
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
            <Button type="submit" disabled={isSaving || !isDirty}>
               {isSaving
                  ? t("storage.saving")
                  : mode === "create"
                    ? t("storage.createButton")
                    : t("storage.saveButton")}
            </Button>
            <Button
               variant="outline"
               type="button"
               onClick={() => setValues(baselineValues)}
               disabled={isSaving || !isDirty}
            >
               {t("storage.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="destructive" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("storage.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
