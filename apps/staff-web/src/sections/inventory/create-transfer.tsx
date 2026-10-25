import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { useInventoryLabels } from "./labels.ts";
import { INVENTORY_INVALIDATE } from "./shared.tsx";
import { AddLineButton, LineCard } from "../../components/form-parts.tsx";

type TransferLine = {
  productId: string;
  productBatchId: string;
  sourceStorageLocationId: string;
  destinationStorageLocationId: string;
  quantity: string;
  notes: string;
};

const transferLineInitial = (): TransferLine => ({
  productId: "",
  productBatchId: "",
  sourceStorageLocationId: "",
  destinationStorageLocationId: "",
  quantity: "1",
  notes: "",
});

const transferInitial = { transferNumber: "", sourceSiteId: "", destinationSiteId: "" };

/** Drafts keep text fields only (see lib/draft.ts), so the transfer lines are not stored. */
const transferDraftSchema = z.object({
  transferNumber: z.string(),
  sourceSiteId: z.string(),
  destinationSiteId: z.string(),
});

/** Create a stock transfer in a side drawer. Mount it only while it should be open. */
export const CreateTransferDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: { ...transferInitial, lines: [transferLineInitial()] },
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/transfers",
        body: {
          transferNumber: value.transferNumber,
          sourceSiteId: value.sourceSiteId,
          destinationSiteId: value.destinationSiteId,
          lines: value.lines.map((line) => ({ ...line, quantity: Number(line.quantity), notes: line.notes || null })),
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Transfer created.",
      });
      if (!ok) return;
      draft.clear();
      onClose();
    },
  });
  const draft = useDraft("inventory-transfer", form, { schema: transferDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title="Create transfer"
      formId="inventory-transfer-form"
      submitLabel="Create transfer"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {draft.banner ? <div className="sm:col-span-2">{draft.banner}</div> : null}
      <form.Field name="transferNumber">
        {(field) => <Field label="Transfer number" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="sourceSiteId">
        {(field) => (
          <SelectField
            label="Source site"
            value={field.state.value}
            onChange={field.handleChange}
            options={labels.siteOptions()}
            required
          />
        )}
      </form.Field>
      <form.Field name="destinationSiteId">
        {(field) => (
          <SelectField
            label="Destination site"
            value={field.state.value}
            onChange={field.handleChange}
            options={labels.siteOptions()}
            required
          />
        )}
      </form.Field>
      {values.lines.map((line, index) => (
        <LineCard
          key={index}
          index={index}
          onRemove={
            values.lines.length > 1
              ? () =>
                  form.setFieldValue(
                    "lines",
                    values.lines.filter((_item, lineIndex) => lineIndex !== index),
                  )
              : undefined
          }
        >
          <form.Field name={`lines[${index}].productId` as const}>
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
          <form.Field name={`lines[${index}].productBatchId` as const}>
            {(field) => (
              <SelectField
                label="Product batch"
                value={field.state.value}
                onChange={field.handleChange}
                options={labels.batchOptions(line.productId)}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].sourceStorageLocationId` as const}>
            {(field) => (
              <SelectField
                label="Source location"
                value={field.state.value}
                onChange={field.handleChange}
                options={labels.locationOptions(values.sourceSiteId)}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].destinationStorageLocationId` as const}>
            {(field) => (
              <SelectField
                label="Destination location"
                value={field.state.value}
                onChange={field.handleChange}
                options={labels.locationOptions(values.destinationSiteId)}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].quantity` as const}>
            {(field) => (
              <Field label="Quantity" type="number" value={field.state.value} onChange={field.handleChange} required />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].notes` as const}>
            {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
        </LineCard>
      ))}
      <AddLineButton onAdd={() => form.setFieldValue("lines", [...values.lines, transferLineInitial()])} />
    </FormDrawer>
  );
};
