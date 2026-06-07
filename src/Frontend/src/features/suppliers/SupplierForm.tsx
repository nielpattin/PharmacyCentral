import { useState } from "react";
import { Button } from "../../components/shadcn/button";
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
            <Field label={t("forms.code")} required>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  required
                  value={values.code}
                  onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))}
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

            <Field label={t("forms.contactName")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.contactName}
                  onChange={(event) => setValues((current) => ({ ...current, contactName: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.email")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  type="email"
                  value={values.email}
                  onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
               />
            </Field>

            <Field label={t("forms.phone")}>
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.phone}
                  onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value }))}
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

            <Field label={t("forms.address")} className="col-span-full">
               <input
                  className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={values.address}
                  onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))}
               />
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
                  ? t("suppliers.saving")
                  : mode === "create"
                    ? t("suppliers.createButton")
                    : t("suppliers.saveButton")}
            </Button>
            <Button
               variant="outline"
               type="button"
               onClick={() => setValues(baselineValues)}
               disabled={isSaving || !isDirty}
            >
               {t("suppliers.reset")}
            </Button>
            {mode === "edit" && onDelete !== undefined ? (
               <Button variant="destructive" type="button" onClick={() => void onDelete()} disabled={isSaving}>
                  {t("suppliers.deleteButton")}
               </Button>
            ) : null}
         </div>
      </form>
   );
}
