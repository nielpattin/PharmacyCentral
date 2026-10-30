import { useForm, useStore } from "@tanstack/react-form";
import { RowActions, useToast } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { GatedButton } from "../../components/gated-button.tsx";
import { withActionColumn } from "../../lib/action-column.ts";
import { Field, SelectField } from "../../components/forms.tsx";
import { ProductPicker } from "../../components/product-picker.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { translateText } from "../../i18n.ts";
import { useSession } from "../../auth.ts";
import { can, ownerOf } from "../../permissions/staff-permissions.ts";
import { useCan } from "../../permissions/use-can.ts";
import { formatQuantity, text, writeJson, type JsonRecord } from "../../staff-api.ts";
import { shortId } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { ADJUSTMENT_STATUSES, ALL_STATUSES, statusParam } from "./status.ts";
import {
  INVENTORY_INVALIDATE,
  ListError,
  PAGE_SIZE,
  StatusFilter,
  statusBadge,
  useBulkWrite,
  useConfirmedAction,
} from "./shared.tsx";
import { CreateAction } from "../../components/form-parts.tsx";

const ADJUSTMENT_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

const adjustmentInitial = {
  productId: "",
  productBatchId: "",
  siteId: "",
  storageLocationId: "",
  adjustmentType: "Positive",
  quantity: "1",
  reason: "",
  notes: "",
};

const BULK_TEMPLATES = {
  approve: {
    success: "{done} of {total} adjustments approved.",
    partial: "{done} of {total} adjustments approved.",
    failedPrefix: "Not completed:",
  },
  reject: {
    success: "{done} of {total} adjustments rejected.",
    partial: "{done} of {total} adjustments rejected.",
    failedPrefix: "Not completed:",
  },
} as const;

const AdjustmentDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: adjustmentInitial,
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/adjustments",
        body: {
          productId: value.productId,
          productBatchId: value.productBatchId,
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          adjustmentType: value.adjustmentType,
          quantity: Number(value.quantity),
          reason: value.reason,
          notes: value.notes || null,
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Adjustment submitted for approval.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const productId = useStore(form.store, (state) => state.values.productId);
  const siteId = useStore(form.store, (state) => state.values.siteId);

  return (
    <FormDrawer
      title="Submit stock adjustment"
      formId="inventory-adjustment-form"
      submitLabel="Submit adjustment"
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
      <form.Field name="adjustmentType">
        {(field) => (
          <SelectField
            label="Adjustment type"
            value={field.state.value}
            onChange={field.handleChange}
            options={[
              { value: "Positive", label: "Positive" },
              { value: "Negative", label: "Negative" },
            ]}
            required
          />
        )}
      </form.Field>
      <form.Field name="quantity">
        {(field) => (
          <Field label="Quantity" type="number" value={field.state.value} onChange={field.handleChange} required />
        )}
      </form.Field>
      <form.Field name="reason">
        {(field) => <Field label="Reason" value={field.state.value} onChange={field.handleChange} required />}
      </form.Field>
      <form.Field name="notes">
        {(field) => <Field label="Notes" value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
    </FormDrawer>
  );
};

export const AdjustmentsTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(ADJUSTMENT_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const createGate = useCan("inventory.adjustment.create");
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate.allowed && !creating });
  const decideGate = useCan("inventory.adjustment.decide");
  const session = useSession();
  const list = usePagedList({
    key: ["staff-inventory", "adjustments"],
    path: "/api/inventory/adjustments",
    params: { q: values.q.trim() || undefined, status: statusParam(values.status) },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels(list.rows.map((row) => text(row.productId, "")));
  const confirmedAction = useConfirmedAction();
  const bulkWrite = useBulkWrite();
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const transition = (id: string, action: "approve" | "reject"): Promise<boolean> => {
    const approve = action === "approve";
    return confirmedAction({
      title: approve ? "Approve this adjustment?" : "Reject this adjustment?",
      description: approve ? "Approved adjustments change stock." : "The adjustment will not change stock.",
      confirmLabel: approve ? "Approve" : "Reject",
      tone: approve ? "default" : "danger",
      path: `/api/inventory/adjustments/${id}/${action}`,
      success: approve ? "Adjustment approved." : "Adjustment rejected.",
    });
  };

  const bulkTransition = async (action: "approve" | "reject"): Promise<void> => {
    // A proposal the signed-in user made is left out: the server refuses its own approval (BR-ADJ-006).
    const targets = list.rows.filter(
      (row) =>
        selected.has(text(row.id, "")) &&
        text(row.status, "") === "Pending" &&
        can("inventory.adjustment.decide", session, ownerOf(row.createdBy)).allowed,
    );
    if (targets.length === 0) {
      toast.info(translateText("Select pending adjustments you did not propose first."));
      return;
    }
    const approve = action === "approve";
    const accepted = await confirm({
      title: approve ? "Approve selected adjustments?" : "Reject selected adjustments?",
      description: "Pending adjustments in the selection are updated. Approved adjustments change stock.",
      confirmLabel: approve ? "Approve" : "Reject",
      tone: approve ? "default" : "danger",
    });
    if (!accepted) return;
    await bulkWrite(
      targets,
      (row) => shortId(text(row.id, "")),
      (row) => writeJson(`/api/inventory/adjustments/${text(row.id, "")}/${action}`, "POST", {}),
      BULK_TEMPLATES[action],
    );
    setSelected(new Set());
  };

  const canDecideRow = (row: JsonRecord): boolean =>
    text(row.status, "") === "Pending" && can("inventory.adjustment.decide", session, ownerOf(row.createdBy)).allowed;

  const columns: Column[] = [
    {
      key: "productId",
      label: "Product",
      render: (row) => labels.product(text(row.productId, "")),
      text: (row) => labels.product(text(row.productId, "")),
      truncate: 32,
    },
    {
      key: "productBatchId",
      hideBelow: "lg",
      label: "Batch",
      render: (row) => labels.batch(text(row.productBatchId, "")),
    },
    { key: "adjustmentType", hideBelow: "md", label: "Type" },
    { key: "quantity", label: "Quantity", align: "right", render: (row) => formatQuantity(row.quantity) },
    { key: "reason", hideBelow: "xl", label: "Reason", truncate: 32 },
    { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => {
        if (!canDecideRow(row)) return null;
        const id = text(row.id, "");
        const owner = ownerOf(row.createdBy);
        return (
          <RowActions label={translateText("Actions")}>
            <GatedButton
              gate={can("inventory.adjustment.decide", session, owner)}
              size="sm"
              onClick={() => void transition(id, "approve")}
            >
              {translateText("Approve")}
            </GatedButton>
            <GatedButton
              gate={can("inventory.adjustment.decide", session, owner)}
              size="sm"
              variant="danger-ghost"
              onClick={() => void transition(id, "reject")}
            >
              {translateText("Reject")}
            </GatedButton>
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create adjustment" gate={createGate} onClick={() => setCreating(true)} />
      <ListError error={list.error} />
      <DataTable
        toolbarStart={
          <StatusFilter
            value={values.status}
            options={ADJUSTMENT_STATUSES}
            onChange={(status) => {
              setSelected(new Set());
              setValues({ status });
            }}
          />
        }
        toolbarExtra={<SavedViewsMenu pageKey="inventory:adjustments" defaults={ADJUSTMENT_DEFAULTS} />}
        rows={list.rows}
        columns={withActionColumn(columns, list.rows.some(canDecideRow))}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{
          value: draft,
          onChange: setDraft,
          placeholder: translateText("Search by reason, notes or batch number"),
        }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        selection={decideGate.allowed ? { keys: selected, onChange: setSelected } : undefined}
        bulkActions={
          <>
            <GatedButton gate={decideGate} size="sm" onClick={() => void bulkTransition("approve")}>
              {translateText("Approve selected")}
            </GatedButton>
            <GatedButton
              gate={decideGate}
              size="sm"
              variant="danger-soft"
              onClick={() => void bulkTransition("reject")}
            >
              {translateText("Reject selected")}
            </GatedButton>
          </>
        }
        storageKey="staff:inventory:adjustments"
        exportCsv={{ filename: "inventory-adjustments.csv" }}
      />
      {creating ? <AdjustmentDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
