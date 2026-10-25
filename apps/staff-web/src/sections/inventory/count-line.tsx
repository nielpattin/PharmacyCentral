import { useForm, useStore } from "@tanstack/react-form";

import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { text, writeJson } from "../../staff-api.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels, type SelectOption } from "./labels.ts";
import { ListError, PAGE_SIZE, useBulkWrite } from "./shared.tsx";
import { AddLineButton, LineCard } from "../../components/form-parts.tsx";
import { translateText } from "../../i18n.ts";

/** Stocktake sessions still open for counting. */
const OPEN_STOCKTAKE_STATUSES = "Pending,InProgress";

const countLineInitial = () => ({ lineId: "", countedQuantity: "" });

const COUNT_TEMPLATES = {
  success: "Counts recorded for {done} of {total} lines.",
  partial: "Counts recorded for {done} of {total} lines.",
  failedPrefix: "Not recorded:",
};

/** Record counted quantities for open stocktake lines in a side drawer. Mount it only while it should be open. */
export const CountLineDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const open = usePagedList({
    key: ["staff-inventory", "open-stocktakes"],
    path: "/api/inventory/stocktakes",
    params: { status: OPEN_STOCKTAKE_STATUSES },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels();
  const bulkWrite = useBulkWrite();

  const lineOptions: SelectOption[] = open.rows.flatMap((session) => {
    const lines = Array.isArray(session.lines) ? session.lines.map(asRecord) : [];
    return lines.map((line) => ({
      value: text(line.id, ""),
      label: [
        labels.site(text(session.siteId, "")),
        labels.batch(text(line.productBatchId, "")),
        translateText(text(line.status, "-")),
      ].join(" · "),
    }));
  });
  const form = useForm({
    defaultValues: { lines: [countLineInitial()] },
    onSubmit: async ({ value }) => {
      const complete = await bulkWrite(
        value.lines,
        (line) => lineOptions.find((option) => option.value === line.lineId)?.label ?? line.lineId,
        (line) =>
          writeJson(`/api/inventory/stocktake-lines/${line.lineId}/count`, "POST", {
            countedQuantity: Number(line.countedQuantity),
          }),
        COUNT_TEMPLATES,
      );
      if (complete) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title="Record stocktake count"
      formId="inventory-count-form"
      submitLabel="Record count"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      <div className="sm:col-span-2">
        <ListError error={open.error} />
      </div>
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
          <form.Field name={`lines[${index}].lineId` as const}>
            {(field) => (
              <SelectField
                label="Stocktake line"
                value={field.state.value}
                onChange={field.handleChange}
                options={lineOptions}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].countedQuantity` as const}>
            {(field) => (
              <Field
                label="Counted quantity"
                type="number"
                value={field.state.value}
                onChange={field.handleChange}
                required
              />
            )}
          </form.Field>
        </LineCard>
      ))}
      <AddLineButton onAdd={() => form.setFieldValue("lines", [...values.lines, countLineInitial()])} />
    </FormDrawer>
  );
};
