import { useForm, useStore } from "@tanstack/react-form";
import { Button } from "@pharmacy/ui";
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
import { text } from "../../staff-api.ts";
import { LineCard } from "./line-card.tsx";
import { PURCHASE_ORDERS_KEY } from "./purchase-order-actions.ts";
import { PurchaseOrderPicker } from "./purchase-order-picker.tsx";
import { GOODS_RECEIPTS_KEY } from "./query-keys.ts";

const goodsReceiptLineSchema = z.object({
  productId: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  manufacturedDate: z.string(),
  manufacturer: z.string(),
  quantity: z.string(),
  notes: z.string(),
});

/** The form's own values; the draft stores exactly these fields. */
const goodsReceiptDraftSchema = z.object({
  receiptNumber: z.string(),
  supplierId: z.string(),
  siteId: z.string(),
  storageLocationId: z.string(),
  purchaseOrderId: z.string(),
  notes: z.string(),
  lines: z.array(goodsReceiptLineSchema),
});

type GoodsReceiptValues = z.infer<typeof goodsReceiptDraftSchema>;
type GoodsReceiptLineValues = GoodsReceiptValues["lines"][number];

/** Receive goods into stock against one site and storage location. Draft autosave, guard and Ctrl+S apply here. */
export const ReceiveGoodsTab = (): React.JSX.Element => {
  const references = useStaffReferences();
  const run = useStaffAction();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: {
      receiptNumber: "",
      supplierId: "",
      siteId: "",
      storageLocationId: "",
      purchaseOrderId: "",
      notes: "",
      lines: [
        {
          productId: "",
          batchNumber: "",
          expiryDate: "",
          manufacturedDate: "",
          manufacturer: "",
          quantity: "1",
          notes: "",
        },
      ],
    } satisfies GoodsReceiptValues,
    onSubmit: async ({ value }) => {
      const saved = await run({
        path: "/api/procurement/goods-receipts",
        body: {
          receiptNumber: value.receiptNumber,
          supplierId: value.supplierId,
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          purchaseOrderId: value.purchaseOrderId || undefined,
          notes: value.notes || undefined,
          receivedAt: new Date().toISOString(),
          lines: value.lines.map((line) => ({
            productId: line.productId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate,
            manufacturedDate: line.manufacturedDate || undefined,
            manufacturer: line.manufacturer || undefined,
            quantity: Number(line.quantity),
            notes: line.notes || undefined,
          })),
        },
        invalidate: [GOODS_RECEIPTS_KEY, PURCHASE_ORDERS_KEY, ["staff-references"]],
        success: "Goods receipt created.",
      });
      if (saved) {
        draft.clear();
        form.reset();
      }
    },
  });
  const draft = useDraft("goods-receipt", form, { schema: goodsReceiptDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const lines = useStore(form.store, (state) => state.values.lines);
  const siteId = useStore(form.store, (state) => state.values.siteId);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  const patchLine = (index: number, patch: Partial<GoodsReceiptLineValues>): void =>
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
        <form.Field name="receiptNumber">
          {(field) => <Field label="Receipt number" value={field.state.value} onChange={field.handleChange} required />}
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
              onChange={(value) => {
                field.handleChange(value);
                form.setFieldValue("storageLocationId", "");
              }}
              options={referenceOptions(references.sites, ["code", "name"])}
              required
            />
          )}
        </form.Field>
        <form.Field name="storageLocationId">
          {(field) => (
            <SelectField
              label="Storage location"
              value={field.state.value}
              onChange={field.handleChange}
              options={referenceOptions(
                references.locations.filter((row) => text(row.siteId, "") === siteId),
                ["code", "name"],
              )}
              required
            />
          )}
        </form.Field>
        <form.Field name="purchaseOrderId">
          {(field) => (
            <PurchaseOrderPicker
              label={translateText("Purchase order (optional)")}
              value={field.state.value}
              onChange={field.handleChange}
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
                label="Batch number"
                value={line.batchNumber}
                onChange={(value) => patchLine(index, { batchNumber: value })}
                required
              />
              <Field
                label="Expiry date"
                type="date"
                value={line.expiryDate}
                onChange={(value) => patchLine(index, { expiryDate: value })}
                required
              />
              <Field
                label="Manufactured date"
                type="date"
                value={line.manufacturedDate}
                onChange={(value) => patchLine(index, { manufacturedDate: value })}
              />
              <Field
                label="Manufacturer"
                value={line.manufacturer}
                onChange={(value) => patchLine(index, { manufacturer: value })}
              />
              <Field
                label="Quantity"
                type="number"
                value={line.quantity}
                onChange={(value) => patchLine(index, { quantity: value })}
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
              form.setFieldValue("lines", (current) => [
                ...current,
                {
                  productId: "",
                  batchNumber: "",
                  expiryDate: "",
                  manufacturedDate: "",
                  manufacturer: "",
                  quantity: "1",
                  notes: "",
                },
              ])
            }
          >
            {translateText("Add line")}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit">{translateText("Receive goods")}</Button>
      </div>
    </form>
  );
};
