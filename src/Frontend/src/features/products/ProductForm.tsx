import { useState } from "react";
import { Button } from "../../components/shadcn/button";
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
         className="grid gap-3"
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
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.sku}
                  onChange={(event) => setValues((current) => ({ ...current, sku: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.name")} required>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.name}
                  onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.category")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.category}
                  onChange={(event) => setValues((current) => ({ ...current, category: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.unit")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.unit}
                  onChange={(event) => setValues((current) => ({ ...current, unit: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.manufacturer")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.manufacturer}
                  onChange={(event) => setValues((current) => ({ ...current, manufacturer: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.status")}>
               <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.status}
                  onChange={(event) => setValues((current) => ({ ...current, status: event.target.value }))}
               >
                  <option value="Active">{t("forms.activeOption")}</option>
                  <option value="Inactive">{t("forms.inactiveOption")}</option>
               </select>
            </Field>

            <Field label={t("forms.notes")} className="col-span-full">
               <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={4}
                  value={values.notes}
                  onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
               />
            </Field>

            <label className="flex items-center gap-2">
               <span className="text-sm font-medium text-foreground">{t("forms.active")}</span>
               <input
                  className="size-4 rounded border border-input accent-primary"
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
               />
            </label>
         </div>

         <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" disabled={isSaving || !isDirty}>
               {isSaving
                  ? t("products.saving")
                  : mode === "create"
                    ? t("products.createButton")
                    : t("products.saveButton")}
            </Button>
            <Button
               variant="outline"
               type="button"
               onClick={() => setValues(baselineValues)}
               disabled={isSaving || !isDirty}
            >
               {t("products.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="destructive" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("products.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
