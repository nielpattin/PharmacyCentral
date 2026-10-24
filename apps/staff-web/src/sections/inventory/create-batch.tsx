import { useForm, useStore } from "@tanstack/react-form";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@pharmacy/ui";
import { useRef } from "react";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { INVENTORY_INVALIDATE } from "./shared.tsx";

const batchInitial = {
  productId: "",
  supplierId: "",
  batchNumber: "",
  manufacturedDate: "",
  expiryDate: "",
  manufacturer: "",
  qualityNotes: "",
};

const batchDraftSchema = z.object({
  productId: z.string(),
  supplierId: z.string(),
  batchNumber: z.string(),
  manufacturedDate: z.string(),
  expiryDate: z.string(),
  manufacturer: z.string(),
  qualityNotes: z.string(),
});

export const CreateBatchTab = (): React.JSX.Element => {
  const formRef = useRef<HTMLFormElement>(null);
  const run = useStaffAction();
  const references = useStaffReferences();
  const form = useForm({
    defaultValues: batchInitial,
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/batches",
        body: {
          productId: value.productId,
          supplierId: value.supplierId || null,
          batchNumber: value.batchNumber,
          manufacturedDate: value.manufacturedDate || null,
          expiryDate: value.expiryDate,
          manufacturer: value.manufacturer || null,
          qualityNotes: value.qualityNotes || null,
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Batch created.",
      });
      if (!ok) return;
      draft.clear();
      form.reset(batchInitial);
    },
  });
  const draft = useDraft("inventory-batch", form, { schema: batchDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  return (
    <div className="grid gap-4">
      {draft.banner}
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{translateText("Create product batch")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <form.Field name="productId">
              {(field) => (
                <div className="sm:col-span-2">
                  <ProductPicker
                    label={translateText("Product")}
                    value={field.state.value}
                    onChange={field.handleChange}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="supplierId">
              {(field) => (
                <SelectField
                  label="Supplier (optional)"
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={referenceOptions(references.suppliers, ["code", "name"])}
                />
              )}
            </form.Field>
            <form.Field name="batchNumber">
              {(field) => (
                <Field label="Batch number" value={field.state.value} onChange={field.handleChange} required />
              )}
            </form.Field>
            <form.Field name="manufacturedDate">
              {(field) => (
                <Field label="Manufactured date" type="date" value={field.state.value} onChange={field.handleChange} />
              )}
            </form.Field>
            <form.Field name="expiryDate">
              {(field) => (
                <Field
                  label="Expiry date"
                  type="date"
                  value={field.state.value}
                  onChange={field.handleChange}
                  required
                />
              )}
            </form.Field>
            <form.Field name="manufacturer">
              {(field) => <Field label="Manufacturer" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
            <form.Field name="qualityNotes">
              {(field) => <Field label="Quality notes" value={field.state.value} onChange={field.handleChange} />}
            </form.Field>
          </CardContent>
          <div className="flex justify-end border-t border-line px-5 py-4">
            <Button type="submit">{translateText("Create batch")}</Button>
          </div>
        </Card>
      </form>
    </div>
  );
};
