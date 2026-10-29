import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";

import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { AddLineButton, LineCard } from "../../components/form-parts.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useDraft } from "../../hooks/useDraft.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { text } from "../../staff-api.ts";
import { firstUnitCostError, parseUnitCost } from "./unit-cost.ts";
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
  unitCost: z.string(),
  notes: z.string(),
});

/** Drafts keep text fields only (see lib/draft.ts), so the receipt lines are not stored. */
const goodsReceiptDraftSchema = z.object({
  receiptNumber: z.string(),
  supplierId: z.string(),
  siteId: z.string(),
  storageLocationId: z.string(),
  purchaseOrderId: z.string(),
  notes: z.string(),
});

type GoodsReceiptValues = z.infer<typeof goodsReceiptDraftSchema> & {
  lines: z.infer<typeof goodsReceiptLineSchema>[];
};
type GoodsReceiptLineValues = GoodsReceiptValues["lines"][number];

/** The cost to send for a line: the number typed, or nothing when the field is blank (the cost is then unknown). */
const unitCostOf = (input: string): number | undefined => {
  const parsed = parseUnitCost(input);
  return parsed.ok && parsed.value !== null ? parsed.value : undefined;
};

/** The hint under the cost field: the reason the typed cost cannot be sent, else what the field is for. */
const unitCostHint = (input: string): string => {
  const parsed = parseUnitCost(input);
  return parsed.ok ? "Optional. Cost of one unit before VAT; leave blank when unknown." : parsed.message;
};

/** Receive goods into stock against one site and storage location, in a side drawer. Mount it only while it should be open. */
export const ReceiveGoodsDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const references = useStaffReferences();
  const run = useStaffAction();
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
          unitCost: "",
          notes: "",
        },
      ],
    } satisfies GoodsReceiptValues,
    onSubmit: async ({ value }) => {
      // The message is already shown under the field of the line, so nothing is sent and nothing is added on top of the form.
      if (firstUnitCostError(value.lines.map((line) => line.unitCost))) return;
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
            unitCost: unitCostOf(line.unitCost),
            notes: line.notes || undefined,
          })),
        },
        invalidate: [GOODS_RECEIPTS_KEY, PURCHASE_ORDERS_KEY, ["staff-references"]],
        success: "Goods receipt created.",
      });
      if (!saved) return;
      draft.clear();
      onClose();
    },
  });
  const draft = useDraft("goods-receipt", form, { schema: goodsReceiptDraftSchema });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const lines = useStore(form.store, (state) => state.values.lines);
  const siteId = useStore(form.store, (state) => state.values.siteId);

  const patchLine = (index: number, patch: Partial<GoodsReceiptLineValues>): void =>
    form.setFieldValue("lines", (current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );

  return (
    <FormDrawer
      title="Receive goods"
      formId="goods-receipt-create-form"
      submitLabel="Receive goods"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {draft.banner ? <div className="sm:col-span-2">{draft.banner}</div> : null}
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
            label="Batch number"
            value={line.batchNumber}
            onChange={(value) => patchLine(index, { batchNumber: value })}
            required
          />
          <Field
            label="Quantity"
            type="number"
            value={line.quantity}
            onChange={(value) => patchLine(index, { quantity: value })}
            required
          />
          <Field
            label="Unit cost (VND per unit)"
            type="number"
            value={line.unitCost}
            onChange={(value) => patchLine(index, { unitCost: value })}
            hint={unitCostHint(line.unitCost)}
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
          <Field label="Line notes" value={line.notes} onChange={(value) => patchLine(index, { notes: value })} />
        </LineCard>
      ))}
      <AddLineButton
        onAdd={() =>
          form.setFieldValue("lines", (current) => [
            ...current,
            {
              productId: "",
              batchNumber: "",
              expiryDate: "",
              manufacturedDate: "",
              manufacturer: "",
              quantity: "1",
              unitCost: "",
              notes: "",
            },
          ])
        }
      />
    </FormDrawer>
  );
};
