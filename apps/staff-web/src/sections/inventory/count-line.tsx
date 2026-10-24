import { useForm, useStore } from "@tanstack/react-form";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@pharmacy/ui";
import { useRef } from "react";

import { Field, SelectField } from "../../components/forms.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { text, writeJson } from "../../staff-api.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels, type SelectOption } from "./labels.ts";
import { AddLineButton, LineCard, ListError, PAGE_SIZE, useBulkWrite } from "./shared.tsx";

/** Stocktake sessions still open for counting. */
const OPEN_STOCKTAKE_STATUSES = "Pending,InProgress";

const countLineInitial = () => ({ lineId: "", countedQuantity: "" });

const COUNT_TEMPLATES = {
  success: "Counts recorded for {done} of {total} lines.",
  partial: "Counts recorded for {done} of {total} lines.",
  failedPrefix: "Not recorded:",
};

export const CountLineTab = (): React.JSX.Element => {
  const formRef = useRef<HTMLFormElement>(null);
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
      if (complete) form.reset({ lines: [countLineInitial()] });
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);
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
      <ListError error={open.error} />
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{translateText("Record stocktake count")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
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
          </CardContent>
          <div className="flex justify-end border-t border-line px-5 py-4">
            <Button type="submit">{translateText("Record count")}</Button>
          </div>
        </Card>
      </form>
    </div>
  );
};
