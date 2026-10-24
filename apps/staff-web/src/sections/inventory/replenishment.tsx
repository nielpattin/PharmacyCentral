import { useForm, useStore } from "@tanstack/react-form";
import { Button, RowActions, useToast } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { useConfirm } from "../../components/confirm.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { formatQuantity, numberValue, text, writeJson, type JsonRecord } from "../../staff-api.ts";
import { asRecord, shortId } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { ALL_STATUSES, REPLENISHMENT_STATUSES, statusParam } from "./status.ts";
import {
  AddLineButton,
  CreateAction,
  INVENTORY_INVALIDATE,
  FormDrawer,
  LineCard,
  ListError,
  ListToolbar,
  PAGE_SIZE,
  StatusFilter,
  statusBadge,
  useBulkWrite,
  useConfirmedAction,
  useFocusSearchHotkey,
} from "./shared.tsx";

const REPLENISHMENT_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

/** A request carries its product and quantity on its lines; the header has neither. */
const linesOf = (row: JsonRecord): JsonRecord[] => (Array.isArray(row.lines) ? row.lines.map(asRecord) : []);

const replenishmentLineInitial = () => ({
  productId: "",
  productBatchId: "",
  requestedQuantity: "1",
  reason: "",
  notes: "",
});

const replenishmentInitial = { siteId: "", storageLocationId: "", notes: "" };

const BULK_TEMPLATES = {
  approve: {
    success: "{done} of {total} requests approved.",
    partial: "{done} of {total} requests approved.",
    failedPrefix: "Not completed:",
  },
  reject: {
    success: "{done} of {total} requests rejected.",
    partial: "{done} of {total} requests rejected.",
    failedPrefix: "Not completed:",
  },
} as const;

const ReplenishmentDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: { ...replenishmentInitial, lines: [replenishmentLineInitial()] },
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/replenishment",
        body: {
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          notes: value.notes || null,
          lines: value.lines.map((line) => ({
            productId: line.productId,
            productBatchId: line.productBatchId,
            requestedQuantity: Number(line.requestedQuantity),
            reason: line.reason || null,
            notes: line.notes || null,
          })),
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Replenishment requested.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title="Request replenishment"
      formId="inventory-replenishment-form"
      submitLabel="Request stock"
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
      <form.Field name="storageLocationId">
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
      <form.Field name="notes">
        {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
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
          <form.Field name={`lines[${index}].requestedQuantity` as const}>
            {(field) => (
              <Field
                label="Requested quantity"
                type="number"
                value={field.state.value}
                onChange={field.handleChange}
                required
              />
            )}
          </form.Field>
          <form.Field name={`lines[${index}].reason` as const}>
            {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
          <form.Field name={`lines[${index}].notes` as const}>
            {(field) => <Field label="Line notes" value={field.state.value} onChange={field.handleChange} />}
          </form.Field>
        </LineCard>
      ))}
      <AddLineButton onAdd={() => form.setFieldValue("lines", [...values.lines, replenishmentLineInitial()])} />
    </FormDrawer>
  );
};

export const ReplenishmentTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(REPLENISHMENT_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: !creating });
  const list = usePagedList({
    key: ["staff-inventory", "replenishment"],
    path: "/api/inventory/replenishment",
    params: { q: values.q.trim() || undefined, status: statusParam(values.status) },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels(list.rows.flatMap((row) => linesOf(row).map((line) => text(line.productId, ""))));
  const productSummary = (row: JsonRecord): string => {
    const lines = linesOf(row);
    const first = lines[0];
    if (first === undefined) return "-";
    const more = lines.length > 1 ? ` +${lines.length - 1}` : "";
    return `${labels.product(text(first.productId, ""))}${more}`;
  };
  const confirmedAction = useConfirmedAction();
  const bulkWrite = useBulkWrite();
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const transition = (id: string, action: "approve" | "reject" | "cancel" | "fulfill"): Promise<boolean> => {
    const steps = {
      approve: {
        title: "Approve this request?",
        description: "The request moves on to fulfilment.",
        confirmLabel: "Approve",
        tone: "default",
        success: "Replenishment approved.",
      },
      reject: {
        title: "Reject this request?",
        description: "The request will not be fulfilled.",
        confirmLabel: "Reject",
        tone: "danger",
        success: "Replenishment rejected.",
      },
      cancel: {
        title: "Cancel this request?",
        description: "The request will not be fulfilled.",
        confirmLabel: "Cancel",
        tone: "danger",
        success: "Replenishment cancelled.",
      },
      fulfill: {
        title: "Mark this request as fulfilled?",
        description: "Confirm the stock has been sent.",
        confirmLabel: "Fulfill",
        tone: "default",
        success: "Replenishment fulfilled.",
      },
    } as const;
    const step = steps[action];
    return confirmedAction({
      title: step.title,
      description: step.description,
      confirmLabel: step.confirmLabel,
      tone: step.tone,
      path: `/api/inventory/replenishment/${id}/${action}`,
      success: step.success,
    });
  };

  const bulkTransition = async (action: "approve" | "reject"): Promise<void> => {
    const targets = list.rows.filter((row) => selected.has(text(row.id, "")) && text(row.status, "") === "Pending");
    if (targets.length === 0) {
      toast.info(translateText("Select pending requests first."));
      return;
    }
    const approve = action === "approve";
    const accepted = await confirm({
      title: approve ? "Approve selected requests?" : "Reject selected requests?",
      description: "Only pending requests in the selection are updated.",
      confirmLabel: approve ? "Approve" : "Reject",
      tone: approve ? "default" : "danger",
    });
    if (!accepted) return;
    await bulkWrite(
      targets,
      (row) => shortId(text(row.id, "")),
      (row) => writeJson(`/api/inventory/replenishment/${text(row.id, "")}/${action}`, "POST", {}),
      BULK_TEMPLATES[action],
    );
    setSelected(new Set());
  };

  const columns: Column[] = [
    { key: "id", label: "Request", render: (row) => shortId(text(row.id, "")) },
    {
      key: "productId",
      label: "Product",
      render: (row) => productSummary(row),
      text: (row) => productSummary(row),
      truncate: 32,
    },
    {
      key: "siteId",
      label: "Site",
      render: (row) => labels.site(text(row.siteId, "")),
      text: (row) => labels.site(text(row.siteId, "")),
    },
    {
      key: "requestedQuantity",
      label: "Quantity",
      align: "right",
      render: (row) => formatQuantity(linesOf(row).reduce((sum, line) => sum + numberValue(line.requestedQuantity), 0)),
    },
    {
      key: "lines",
      label: "Lines",
      align: "right",
      render: (row) => (Array.isArray(row.lines) ? row.lines.length : 1),
    },
    { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => {
        const id = text(row.id, "");
        const status = text(row.status, "");
        if (status === "Pending") {
          return (
            <RowActions label={translateText("Actions")}>
              <Button size="sm" onClick={() => void transition(id, "approve")}>
                {translateText("Approve")}
              </Button>
              <Button size="sm" variant="danger-soft" onClick={() => void transition(id, "reject")}>
                {translateText("Reject")}
              </Button>
            </RowActions>
          );
        }
        if (status === "Approved") {
          return (
            <RowActions label={translateText("Actions")}>
              <Button size="sm" onClick={() => void transition(id, "fulfill")}>
                {translateText("Fulfill")}
              </Button>
              <Button size="sm" variant="danger-soft" onClick={() => void transition(id, "cancel")}>
                {translateText("Cancel")}
              </Button>
            </RowActions>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Request stock" onClick={() => setCreating(true)} />
      <ListToolbar pageKey="inventory:replenishment" defaults={REPLENISHMENT_DEFAULTS}>
        <StatusFilter
          value={values.status}
          options={REPLENISHMENT_STATUSES}
          onChange={(status) => {
            setSelected(new Set());
            setValues({ status });
          }}
        />
      </ListToolbar>
      <ListError error={list.error} />
      <DataTable
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by notes or batch number") }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        selection={{ keys: selected, onChange: setSelected }}
        bulkActions={
          <>
            <Button size="sm" onClick={() => void bulkTransition("approve")}>
              {translateText("Approve selected")}
            </Button>
            <Button size="sm" variant="danger-soft" onClick={() => void bulkTransition("reject")}>
              {translateText("Reject selected")}
            </Button>
          </>
        }
        storageKey="staff:inventory:replenishment"
        exportCsv={{ filename: "inventory-replenishment.csv" }}
      />
      {creating ? <ReplenishmentDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
