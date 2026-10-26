import { useForm, useStore } from "@tanstack/react-form";
import { Button, RowActions } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { GatedButton } from "../../components/gated-button.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
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
import { can, ownerOf, type AccessResult, type PermissionSession } from "../../permissions/staff-permissions.ts";
import { useCan } from "../../permissions/use-can.ts";
import { CountLineDrawer } from "./count-line.tsx";
import { formatQuantity, text, type JsonRecord } from "../../staff-api.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { ALL_STATUSES, STOCKTAKE_STATUSES, statusParam, statusTone } from "./status.ts";
import {
  Fact,
  FactList,
  INVENTORY_INVALIDATE,
  ListError,
  PAGE_SIZE,
  StatusFilter,
  statusBadge,
  useConfirmedAction,
} from "./shared.tsx";
import { AddLineButton, CreateAction, LineCard } from "../../components/form-parts.tsx";

const STOCKTAKE_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

const stocktakeLineInitial = () => ({ productBatchId: "" });

const stocktakeInitial = { siteId: "", storageLocationId: "", notes: "" };

const StocktakeDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const labels = useInventoryLabels();
  const form = useForm({
    defaultValues: { ...stocktakeInitial, lines: [stocktakeLineInitial()] },
    onSubmit: async ({ value }) => {
      const ok = await run({
        path: "/api/inventory/stocktakes",
        body: {
          siteId: value.siteId,
          storageLocationId: value.storageLocationId,
          notes: value.notes || null,
          lines: value.lines.map((line) => ({ productBatchId: line.productBatchId })),
        },
        invalidate: INVENTORY_INVALIDATE,
        success: "Stocktake created.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title="Create stocktake"
      formId="inventory-stocktake-form"
      submitLabel="Create stocktake"
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
          <p className="text-xs text-muted sm:col-span-2">
            {translateText(
              "The system quantity is captured from the selected inventory balance when the session is created.",
            )}
          </p>
        </LineCard>
      ))}
      <AddLineButton onAdd={() => form.setFieldValue("lines", [...values.lines, stocktakeLineInitial()])} />
    </FormDrawer>
  );
};

const stocktakeLineColumns = (product: (id: string) => string, batch: (id: string) => string): Column[] => [
  { key: "productId", label: "Product", render: (row) => product(text(row.productId, "")) },
  { key: "productBatchId", label: "Batch", render: (row) => batch(text(row.productBatchId, "")) },
  {
    key: "systemQuantity",
    label: "System quantity",
    align: "right",
    render: (row) => formatQuantity(row.systemQuantity),
  },
  {
    key: "countedQuantity",
    label: "Counted quantity",
    align: "right",
    render: (row) => formatQuantity(row.countedQuantity),
  },
  { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
];

/**
 * Posting turns the counts into stock variances, so the creator of the session and anyone who counted one of its lines
 * may not post it (BR-STK-007); the role is Pharmacy Manager (inventory operations Decision 3).
 */
const postGate = (session: PermissionSession, stocktake: JsonRecord): AccessResult => {
  const lines = Array.isArray(stocktake.lines) ? stocktake.lines.map(asRecord) : [];
  const countedByMe = lines.some((line) => line.countedBy === session.userId);
  const role = can("inventory.stocktake.post", session, ownerOf(stocktake.createdBy));
  if (!role.allowed || !countedByMe) return role;
  return { allowed: false, reason: translateText("You cannot approve your own change") };
};

const StocktakeDetail = ({
  stocktake,
  gate,
  onClose,
  onPost,
}: {
  stocktake: JsonRecord;
  gate: AccessResult;
  onClose: () => void;
  onPost: () => void;
}): React.JSX.Element => {
  const lines = Array.isArray(stocktake.lines) ? stocktake.lines.map(asRecord) : [];
  const labels = useInventoryLabels(lines.map((line) => text(line.productId, "")));
  const status = text(stocktake.status, "");
  const canPost = status === "Pending" || status === "InProgress";
  return (
    <EntityDrawer
      open
      onClose={onClose}
      title={translateText("Stocktake")}
      subtitle={labels.site(text(stocktake.siteId, ""))}
      status={{ label: translateText(status), tone: statusTone(status) }}
      details={
        <div className="grid gap-4">
          <FactList>
            <Fact label="Location">{labels.location(text(stocktake.storageLocationId, ""))}</Fact>
            <Fact label="Lines">{String(lines.length)}</Fact>
            <Fact label="Notes">{text(stocktake.notes, "-")}</Fact>
          </FactList>
          <DataTable
            rows={lines}
            columns={stocktakeLineColumns(labels.product, labels.batch)}
            getKey={(row) => text(row.id, "")}
            empty="No lines"
            interactive={false}
            virtualize={false}
          />
        </div>
      }
      footer={
        canPost ? (
          <GatedButton gate={gate} size="sm" onClick={onPost}>
            {translateText("Post adjustments")}
          </GatedButton>
        ) : undefined
      }
    />
  );
};

export const StocktakeTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(STOCKTAKE_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const createGate = useCan("inventory.stocktake.create");
  const countGate = useCan("inventory.stocktake.count");
  const session = useSession();
  const [creating, setCreating] = useState(false);
  const [counting, setCounting] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate.allowed && !creating && !counting });
  const list = usePagedList({
    key: ["staff-inventory", "stocktakes"],
    path: "/api/inventory/stocktakes",
    params: { q: values.q.trim() || undefined, status: statusParam(values.status) },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels();
  const confirmedAction = useConfirmedAction();
  const [selected, setSelected] = useState<JsonRecord>();

  const post = (row: JsonRecord): Promise<boolean> =>
    confirmedAction({
      title: "Post stocktake adjustments?",
      description: "The counted differences are posted to stock. This cannot be undone from this screen.",
      confirmLabel: "Post adjustments",
      path: `/api/inventory/stocktakes/${text(row.id, "")}/post`,
      success: "Stocktake posted.",
    });

  const columns: Column[] = [
    { key: "id", label: "Session", render: (row) => text(row.id, "").slice(0, 8) },
    {
      key: "siteId",
      label: "Site",
      render: (row) => labels.site(text(row.siteId, "")),
      text: (row) => labels.site(text(row.siteId, "")),
    },
    { key: "storageLocationId", label: "Location", render: (row) => labels.location(text(row.storageLocationId, "")) },
    { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
    {
      key: "lines",
      label: "Lines",
      align: "right",
      render: (row) => (Array.isArray(row.lines) ? row.lines.length : 0),
    },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => (
        <RowActions label={translateText("Actions")}>
          <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
            {translateText("View")}
          </Button>
          {text(row.status, "") === "Pending" ? (
            <GatedButton gate={postGate(session, row)} size="sm" onClick={() => void post(row)}>
              {translateText("Post adjustments")}
            </GatedButton>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create stocktake" gate={createGate} onClick={() => setCreating(true)} />
      <CreateAction label="Record count" variant="secondary" gate={countGate} onClick={() => setCounting(true)} />
      <ListError error={list.error} />
      <DataTable
        toolbarStart={
          <StatusFilter
            value={values.status}
            options={STOCKTAKE_STATUSES}
            onChange={(status) => setValues({ status })}
          />
        }
        toolbarExtra={<SavedViewsMenu pageKey="inventory:stocktakes" defaults={STOCKTAKE_DEFAULTS} />}
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by notes or batch number") }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        storageKey="staff:inventory:stocktakes"
        exportCsv={{ filename: "inventory-stocktakes.csv" }}
      />
      {selected ? (
        <StocktakeDetail
          stocktake={selected}
          gate={postGate(session, selected)}
          onClose={() => setSelected(undefined)}
          onPost={() => void post(selected).then((ok) => ok && setSelected(undefined))}
        />
      ) : null}
      {creating ? <StocktakeDrawer onClose={() => setCreating(false)} /> : null}
      {counting ? <CountLineDrawer onClose={() => setCounting(false)} /> : null}
    </div>
  );
};
