import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
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

/** Create a product batch in a side drawer. Mount it only while it should be open. */
export const CreateBatchDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
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
      onClose();
    },
  });
  const draft = useDraft("inventory-batch", form, { schema: batchDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);

  return (
    <FormDrawer
      title="Create batch"
      formId="inventory-batch-form"
      submitLabel="Create batch"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {draft.banner ? <div className="sm:col-span-2">{draft.banner}</div> : null}
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
        {(field) => <Field label="Batch number" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="manufacturedDate">
        {(field) => (
          <Field label="Manufactured date" type="date" value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>
      <form.Field name="expiryDate">
        {(field) => (
          <Field label="Expiry date" type="date" value={field.state.value} onChange={field.handleChange} required />
        )}
      </form.Field>
      <form.Field name="manufacturer">
        {(field) => <Field label="Manufacturer" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="qualityNotes">
        {(field) => <Field label="Quality notes" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
    </FormDrawer>
  );
};
