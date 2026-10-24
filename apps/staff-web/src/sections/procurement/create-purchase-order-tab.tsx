import { useForm, useStore } from "@tanstack/react-form";
import { Button } from "@pharmacy/ui";
import { useRef } from "react";
import { z } from "zod";

import { ProductPicker } from "../../components/product-picker.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { LineCard } from "./line-card.tsx";
import { PURCHASE_ORDERS_KEY } from "./purchase-order-actions.ts";

const purchaseOrderLineSchema = z.object({
  productId: z.string(),
  orderedQuantity: z.string(),
  notes: z.string(),
});

/** The form's own values; the draft stores exactly these fields. */
const purchaseOrderDraftSchema = z.object({
  purchaseOrderNumber: z.string(),
  supplierId: z.string(),
  siteId: z.string(),
  expectedDate: z.string(),
  notes: z.string(),
  lines: z.array(purchaseOrderLineSchema),
});

type PurchaseOrderValues = z.infer<typeof purchaseOrderDraftSchema>;

/** Create a purchase order. Draft autosave, unsaved-changes guard and Ctrl+S apply here. */
export const CreatePurchaseOrderTab = (): React.JSX.Element => {
  const references = useStaffReferences();
  const run = useStaffAction();
  const formRef = useRef<HTMLFormElement>(null);
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
      if (saved) {
        draft.clear();
        form.reset();
      }
    },
  });
  const draft = useDraft("purchase-order", form, { schema: purchaseOrderDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const lines = useStore(form.store, (state) => state.values.lines);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  const patchLine = (index: number, patch: Partial<PurchaseOrderValues["lines"][number]>): void =>
    form.setFieldValue("lines", (current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );

  return (
    <form
      ref={formRef}
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {draft.banner}
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="purchaseOrderNumber">
          {(field) => <Field label="Purchase order number" value={field.state.value} onChange={field.handleChange} />}
        </form.Field>
        <form.Field name="expectedDate">
          {(field) => (
            <Field label="Expected date" type="date" value={field.state.value} onChange={field.handleChange} />
          )}
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
          {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
        </form.Field>
      </div>
      <div className="grid gap-3">
        {lines.map((line, index) => (
          <LineCard
            key={index}
            index={index}
            removable={lines.length > 1}
            onRemove={() =>
              form.setFieldValue("lines", (current) => current.filter((_line, lineIndex) => lineIndex !== index))
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <ProductPicker
                label={translateText("Product")}
                value={line.productId}
                onChange={(productId) => patchLine(index, { productId })}
                required
              />
              <Field
                label="Ordered quantity"
                type="number"
                value={line.orderedQuantity}
                onChange={(value) => patchLine(index, { orderedQuantity: value })}
                required
              />
              <Field label="Line notes" value={line.notes} onChange={(value) => patchLine(index, { notes: value })} />
            </div>
          </LineCard>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              form.setFieldValue("lines", (current) => [...current, { productId: "", orderedQuantity: "1", notes: "" }])
            }
          >
            {translateText("Add line")}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit">{translateText("Create order")}</Button>
      </div>
    </form>
  );
};
