import { useMemo, useState } from "react";
import { Button } from "../../components/shadcn/button";
import { Field } from "../../components/ui/Field";
import type { SiteDto, StorageLocationDto } from "../../api/pharmacyClient";
import { useT } from "../../lib/i18n";
import { areStocktakeSessionFormValuesEqual, type StocktakeSessionFormValues } from "../../pages/shared/stocktakeForms";

type StocktakeSessionFormProps = {
   initialValues: StocktakeSessionFormValues;
   isSaving: boolean;
   sites: SiteDto[];
   storageLocations: StorageLocationDto[];
   mode: "create" | "edit";
   onSubmit: (values: StocktakeSessionFormValues) => Promise<void>;
};

export function StocktakeSessionForm({
   initialValues,
   isSaving,
   sites,
   storageLocations,
   mode,
   onSubmit,
}: StocktakeSessionFormProps) {
   const t = useT();
   const [values, setValues] = useState(initialValues);
   const [baselineValues, setBaselineValues] = useState(initialValues);
   const [validationError, setValidationError] = useState<string | null>(null);
   const isDirty = !areStocktakeSessionFormValuesEqual(values, baselineValues);
   const availableStorageLocations = useMemo(
      () =>
         values.siteId === ""
            ? storageLocations
            : storageLocations.filter((location) => location.siteId === values.siteId),
      [storageLocations, values.siteId],
   );

   function validate() {
      return values.siteId === "" || values.storageLocationId === "" ? t("stocktake.validationSession") : null;
   }

   return (
      <form
         className="grid gap-3"
         onSubmit={async (event) => {
            event.preventDefault();
            if (isSaving || !isDirty) return;
            const error = validate();
            setValidationError(error);
            if (error !== null) return;
            await onSubmit(values);
            setBaselineValues(values);
         }}
      >
         {validationError !== null ? <div className="notice danger-note">{validationError}</div> : null}
         <div className="form-grid">
            <Field label={t("stocktake.site")} required>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.siteId}
                  onChange={(event) =>
                     setValues((current) => ({ ...current, siteId: event.target.value, storageLocationId: "" }))
                  }
               >
                  <option value="">{t("forms.selectSite")}</option>
                  {sites.map((site) => (
                     <option key={site.id} value={site.id}>
                        {site.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("stocktake.location")} required>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.storageLocationId}
                  onChange={(event) => setValues((current) => ({ ...current, storageLocationId: event.target.value }))}
               >
                  <option value="">{t("stocktake.selectLocation")}</option>
                  {availableStorageLocations.map((location) => (
                     <option key={location.id} value={location.id}>
                        {location.name}
                     </option>
                  ))}
               </select>
            </Field>
            <Field label={t("forms.notes")} className="col-span-full">
               <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={3}
                  value={values.notes}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
               />
            </Field>
         </div>
         <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" disabled={isSaving || !isDirty}>
               {isSaving ? t("stocktake.saving") : mode === "create" ? t("stocktake.createButton") : t("common.edit")}
            </Button>
            <Button
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
