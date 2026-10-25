import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";

import { FormDrawer } from "../../components/form-drawer.tsx";
import { AddLineButton, LineCard } from "../../components/form-parts.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { PURCHASE_ORDERS_KEY } from "./purchase-order-actions.ts";

const purchaseOrderLineSchema = z.object({
  productId: z.string(),
  orderedQuantity: z.string(),
  notes: z.string(),
});

/** Drafts keep text fields only (see lib/draft.ts), so the order lines are not stored. */
const purchaseOrderDraftSchema = z.object({
  purchaseOrderNumber: z.string(),
  supplierId: z.string(),
  siteId: z.string(),
  expectedDate: z.string(),
  notes: z.string(),
});

type PurchaseOrderValues = z.infer<typeof purchaseOrderDraftSchema> & {
  lines: z.infer<typeof purchaseOrderLineSchema>[];
};

/** Create a purchase order in a side drawer. Mount it only while it should be open. */
export const CreatePurchaseOrderDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const references = useStaffReferences();
  const run = useStaffAction();
  const form = useForm({
    defaultValues: {
      purchaseOrderNumber: "",
      supplierId: "",
      siteId: "",
      expectedDate: "",
      notes: "",
      lines: [{ productId: "", orderedQuantity: "1", notes: "" }],
    } satisfies PurchaseOrderValues,
    onSubmit: async ({ value }) => {
      const saved = await run({
        path: "/api/procurement/purchase-orders",
        body: {
          purchaseOrderNumber: value.purchaseOrderNumber || undefined,
          supplierId: value.supplierId,
          siteId: value.siteId,
          expectedDate: value.expectedDate || undefined,
          notes: value.notes || undefined,
          lines: value.lines.map((line) => ({
            productId: line.productId,
            orderedQuantity: Number(line.orderedQuantity),
            notes: line.notes || undefined,
          })),
        },
        invalidate: [PURCHASE_ORDERS_KEY],
        success: "Purchase order created.",
      });
      if (!saved) return;
      draft.clear();
      onClose();
    },
  });
  const draft = useDraft("purchase-order", form, { schema: purchaseOrderDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const lines = useStore(form.store, (state) => state.values.lines);

  const patchLine = (index: number, patch: Partial<PurchaseOrderValues["lines"][number]>): void =>
    form.setFieldValue("lines", (current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );

  return (
    <FormDrawer
      title="Create order"
      formId="purchase-order-create-form"
      submitLabel="Create order"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {draft.banner ? <div className="sm:col-span-2">{draft.banner}</div> : null}
      <form.Field name="purchaseOrderNumber">
        {(field) => <Field label="Purchase order number" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="expectedDate">
        {(field) => <Field label="Expected date" type="date" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="supplierId">
        {(field) => (
          <SelectField
            label="Supplier"
            value={field.state.value}
            onChange={field.handleChange}
            options={referenceOptions(references.suppliers, ["code", "name"])}
            required
          />
        )}
      </form.Field>
      <form.Field name="siteId">
        {(field) => (
          <SelectField
            label="Site"
            value={field.state.value}
            onChange={field.handleChange}
            options={referenceOptions(references.sites, ["code", "name"])}
            required
          />
        )}
      </form.Field>
      <form.Field name="notes">
        {(field) => (
          <div className="sm:col-span-2">
            <Field label="Notes" value={field.state.value} onChange={field.handleChange} />
          </div>
        )}
      </form.Field>
      {lines.map((line, index) => (
        <LineCard
          key={index}
          index={index}
          onRemove={
            lines.length > 1
              ? () =>
                  form.setFieldValue("lines", (current) => current.filter((_line, lineIndex) => lineIndex !== index))
              : undefined
          }
        >
          <div className="sm:col-span-2">
            <ProductPicker
              label={translateText("Product")}
              value={line.productId}
              onChange={(productId) => patchLine(index, { productId })}
              required
            />
          </div>
          <Field
            label="Ordered quantity"
            type="number"
            value={line.orderedQuantity}
            onChange={(value) => patchLine(index, { orderedQuantity: value })}
            required
          />
          <Field label="Line notes" value={line.notes} onChange={(value) => patchLine(index, { notes: value })} />
        </LineCard>
      ))}
      <AddLineButton
        onAdd={() =>
          form.setFieldValue("lines", (current) => [...current, { productId: "", orderedQuantity: "1", notes: "" }])
        }
      />
    </FormDrawer>
  );
};
