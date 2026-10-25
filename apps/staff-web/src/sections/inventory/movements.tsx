import { useForm, useStore } from "@tanstack/react-form";
import { useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, formatQuantity, text } from "../../staff-api.ts";
import { useInventoryLabels } from "./labels.ts";
import { INVENTORY_INVALIDATE, ListError, PAGE_SIZE } from "./shared.tsx";
import { CreateAction } from "../../components/form-parts.tsx";

/** Columns shared by the movements list and a batch's history: change, balance after, type, time. */
export const MOVEMENT_HISTORY_COLUMNS: Column[] = [
  { key: "quantityDelta", label: "Change", align: "right", render: (row) => formatQuantity(row.quantityDelta) },
  { key: "quantityAfter", label: "After", align: "right", render: (row) => formatQuantity(row.quantityAfter) },
  { key: "movementType", label: "Type", render: (row) => translateText(text(row.movementType, "-")) },
  { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
];

const movementInitial = {
  productId: "",
  productBatchId: "",
  siteId: "",
  storageLocationId: "",
  quantityDelta: "",
  movementType: "Adjustment",
  reason: "",
  occurredAtUtc: "",
  referenceType: "",
  referenceId: "",
  notes: "",
};

const MovementDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: movementInitial,
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/movements",
        body: {
          productId: value.productId,
          productBatchId: value.productBatchId || undefined,
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          quantityDelta: Number(value.quantityDelta),
          movementType: value.movementType,
          reason: value.reason || undefined,
          occurredAtUtc: value.occurredAtUtc || null,
          referenceType: value.referenceType || null,
          referenceId: value.referenceId || null,
          notes: value.notes || null,
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Stock movement recorded.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const productId = useStore(form.store, (state) => state.values.productId);
  const siteId = useStore(form.store, (state) => state.values.siteId);

  return (
    <FormDrawer
      title="Record stock movement"
      formId="inventory-movement-form"
      submitLabel="Record movement"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      <form.Field name="productId">
        {(field) => (
          <ProductPicker
            label={translateText("Product")}
            value={field.state.value}
            onChange={field.handleChange}
            required
          />
        )}
      </form.Field>
      <form.Field name="productBatchId">
        {(field) => (
          <SelectField
            label="Product batch"
            value={field.state.value}
            onChange={field.handleChange}
            options={labels.batchOptions(productId)}
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
            options={labels.siteOptions()}
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
            options={labels.locationOptions(siteId)}
            required
          />
        )}
      </form.Field>
      <form.Field name="quantityDelta">
        {(field) => (
          <Field
            label="Quantity delta"
            type="number"
            value={field.state.value}
            onChange={field.handleChange}
            required
          />
        )}
      </form.Field>
      <form.Field name="movementType">
        {(field) => <Field label="Movement type" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="reason">
        {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="occurredAtUtc">
        {(field) => (
          <Field label="Occurred at" type="datetime-local" value={field.state.value} onChange={field.handleChange} />
        )}
      </form.Field>
      <form.Field name="referenceType">
        {(field) => <Field label="Reference type" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="referenceId">
        {(field) => <Field label="Reference ID" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="notes">
        {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
    </FormDrawer>
  );
};

export const MovementsTab = (): React.JSX.Element => {
  const list = usePagedList({
    key: ["staff-inventory", "movements"],
    path: "/api/inventory/movements",
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels(list.rows.map((row) => text(row.productId, "")));
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: !creating });

  const columns: Column[] = [
    {
      key: "productId",
      label: "Product",
      render: (row) => labels.product(text(row.productId, "")),
      text: (row) => labels.product(text(row.productId, "")),
      truncate: 32,
    },
    { key: "productBatchId", label: "Batch", render: (row) => labels.batch(text(row.productBatchId, "")) },
    ...MOVEMENT_HISTORY_COLUMNS,
  ];

  return (
    <div className="grid gap-3">
      <CreateAction label="Record movement" onClick={() => setCreating(true)} />
      <ListError error={list.error} />
      <DataTable
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        storageKey="staff:inventory:movements"
        exportCsv={{ filename: "inventory-movements.csv" }}
      />
      {creating ? <MovementDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
