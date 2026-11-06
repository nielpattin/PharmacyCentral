import { useForm, useStore } from "@tanstack/react-form";
import { useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { formatDateTime, text } from "../../staff-api.ts";
import { shortId } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { INVENTORY_INVALIDATE, ListError, PAGE_SIZE } from "./shared.tsx";
import { AddLineButton, CreateAction, LineCard } from "../../components/form-parts.tsx";
import { useCan } from "../../permissions/use-can.ts";

const returnLineInitial = () => ({
  productBatchId: "",
  storageLocationId: "",
  quantity: "1",
  destination: "",
  notes: "",
});

const returnInitial = { siteId: "", reason: "", destination: "", occurredAtUtc: "" };

const ReturnDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: { ...returnInitial, lines: [returnLineInitial()] },
    onSubmit: async ({ value }) => {
      const occurredAtUtc = value.occurredAtUtc ? new Date(value.occurredAtUtc).toISOString() : null;
      const ok = await run({
        path: "/api/inventory/returns",
        body: {
          siteId: value.siteId,
          reason: value.reason,
          destination: value.destination || null,
          occurredAtUtc,
          lines: value.lines.map((line) => ({
            ...line,
            quantity: Number(line.quantity),
            destination: line.destination || value.destination || null,
            notes: line.notes || null,
            occurredAtUtc,
          })),
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Return/removal recorded.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title="Record return or removal"
      formId="inventory-return-form"
      submitLabel="Record return"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
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
      <form.Field name="reason">
        {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="destination">
        {(field) => <Field label="Destination" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="occurredAtUtc">
        {(field) => (
          <Field label="Occurred at" type="datetime-local" value={field.state.value} onChange={field.handleChange} />
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
          <form.Field name={`lines[${index}].productBatchId` as const}>
            {(field) => (
              <SelectField
                label="Product batch"
                value={field.state.value}
                onChange={field.handleChange}
                options={labels.batchOptions()}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].storageLocationId` as const}>
            {(field) => (
              <SelectField
                label="Storage location"
                value={field.state.value}
                onChange={field.handleChange}
                options={labels.locationOptions(values.siteId)}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].quantity` as const}>
            {(field) => (
              <Field label="Quantity" type="number" value={field.state.value} onChange={field.handleChange} required />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].destination` as const}>
            {(field) => <Field label="Line destination" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
          <form.Field name={`lines[${index}].notes` as const}>
            {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
        </LineCard>
      ))}
      <AddLineButton onAdd={() => form.setFieldValue("lines", [...values.lines, returnLineInitial()])} />
    </FormDrawer>
  );
};

export const ReturnsTab = (): React.JSX.Element => {
  const list = usePagedList({
    key: ["staff-inventory", "returns"],
    path: "/api/inventory/returns",
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels();
  const createGate = useCan("inventory.return.create");
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate.allowed && !creating });

  const columns: Column[] = [
    { key: "id", label: "Return", render: (row) => shortId(text(row.id, "")) },
    {
      key: "siteId",
      label: "Site",
      render: (row) => labels.site(text(row.siteId, "")),
      text: (row) => labels.site(text(row.siteId, "")),
    },
    { key: "reason", label: "Reason", truncate: 40 },
    { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) },
  ];

  return (
    <div className="grid gap-3">
      <CreateAction label="Record return or removal" gate={createGate} onClick={() => setCreating(true)} />
      <ListError error={list.error} />
      <DataTable
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        paging={list.paging}
        storageKey="staff:inventory:returns"
        exportCsv={{ filename: "inventory-returns.csv" }}
      />
      {creating ? <ReturnDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
