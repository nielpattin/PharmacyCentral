import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { Button, RowActions, Skeleton } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { Field } from "../../components/forms.tsx";
import { GatedButton } from "../../components/gated-button.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { translateText } from "../../i18n.ts";
import { useSession } from "../../auth.ts";
import { can, ownerOf, type StaffAction } from "../../permissions/staff-permissions.ts";
import { useCan } from "../../permissions/use-can.ts";
import { formatDateTime, formatQuantity, numberValue, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { ALL_STATUSES, statusParam, statusTone, TRANSFER_STATUSES } from "./status.ts";
import { CreateTransferDrawer, type TransferPrefill } from "./create-transfer.tsx";
import { TransferSuggestions } from "./transfer-suggestions/suggestions.tsx";
import { Fact, FactList, ListError, PAGE_SIZE, StatusFilter, statusBadge, useConfirmedAction } from "./shared.tsx";
import { CreateAction, LineCard } from "../../components/form-parts.tsx";

const TRANSFER_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

type TransferView = { id: string; mode?: "ship" | "receive" };

/** The create drawer is open either empty or filled from a transfer suggestion. */
type CreateTransferState = { initial?: TransferPrefill | undefined };

export const TransfersTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(TRANSFER_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const createGate = useCan("inventory.transfer.create");
  const session = useSession();
  const gateFor = (action: StaffAction, row: JsonRecord) => can(action, session, ownerOf(row.createdBy));
  const [creating, setCreating] = useState<CreateTransferState>();
  useHotkey("n", () => setCreating({}), {
    label: "Create new",
    when: createGate.allowed && creating === undefined,
  });
  const list = usePagedList({
    key: ["staff-inventory", "transfers"],
    path: "/api/inventory/transfers",
    params: { q: values.q.trim() || undefined, status: statusParam(values.status) },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels();
  const confirmedAction = useConfirmedAction();
  const [view, setView] = useState<TransferView>();

  const transition = (row: JsonRecord, action: "approve" | "cancel"): Promise<boolean> => {
    const approve = action === "approve";
    return confirmedAction({
      title: approve ? "Approve this transfer?" : "Cancel this transfer?",
      description: approve ? "The transfer moves on to the next step." : "The transfer will not go ahead.",
      confirmLabel: approve ? "Approve" : "Cancel transfer",
      tone: approve ? "default" : "danger",
      path: `/api/inventory/transfers/${text(row.id, "")}/${action}`,
      success: approve ? "Transfer approved." : "Transfer cancelled.",
    });
  };

  const columns: Column[] = [
    { key: "transferNumber", label: "Transfer" },
    { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
    {
      key: "sourceSiteId",
      label: "From",
      render: (row) => labels.site(text(row.sourceSiteId, "")),
      text: (row) => labels.site(text(row.sourceSiteId, "")),
    },
    {
      key: "destinationSiteId",
      label: "To",
      render: (row) => labels.site(text(row.destinationSiteId, "")),
      text: (row) => labels.site(text(row.destinationSiteId, "")),
    },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => {
        const id = text(row.id, "");
        const status = text(row.status, "");
        return (
          <RowActions label={translateText("Actions")}>
            <Button size="sm" variant="ghost" onClick={() => setView({ id })}>
              {translateText("View")}
            </Button>
            {status === "PendingApproval" ? (
              <>
                <GatedButton
                  gate={gateFor("inventory.transfer.approve", row)}
                  size="sm"
                  onClick={() => void transition(row, "approve")}
                >
                  {translateText("Approve")}
                </GatedButton>
                <GatedButton
                  gate={gateFor("inventory.transfer.cancel", row)}
                  size="sm"
                  variant="danger-ghost"
                  onClick={() => void transition(row, "cancel")}
                >
                  {translateText("Cancel")}
                </GatedButton>
              </>
            ) : null}
            {status === "Approved" ? (
              <>
                <GatedButton
                  gate={gateFor("inventory.transfer.transition", row)}
                  size="sm"
                  variant="ghost"
                  onClick={() => setView({ id, mode: "ship" })}
                >
                  {translateText("Ship")}
                </GatedButton>
                <GatedButton
                  gate={gateFor("inventory.transfer.cancel", row)}
                  size="sm"
                  variant="danger-ghost"
                  onClick={() => void transition(row, "cancel")}
                >
                  {translateText("Cancel")}
                </GatedButton>
              </>
            ) : null}
            {status === "InTransit" ? (
              <GatedButton
                gate={gateFor("inventory.transfer.transition", row)}
                size="sm"
                variant="ghost"
                onClick={() => setView({ id, mode: "receive" })}
              >
                {translateText("Receive")}
              </GatedButton>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create transfer" gate={createGate} onClick={() => setCreating({})} />
      <TransferSuggestions onCreate={(initial) => setCreating({ initial })} />
      <ListError error={list.error} />
      <DataTable
        toolbarStart={
          <StatusFilter
            value={values.status}
            options={TRANSFER_STATUSES}
            onChange={(status) => setValues({ status })}
          />
        }
        toolbarExtra={<SavedViewsMenu pageKey="inventory:transfers" defaults={TRANSFER_DEFAULTS} />}
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by transfer number") }}
        paging={list.paging}
        storageKey="staff:inventory:transfers"
        exportCsv={{ filename: "inventory-transfers.csv" }}
      />
      {creating ? <CreateTransferDrawer onClose={() => setCreating(undefined)} initial={creating.initial} /> : null}
      {view ? (
        <TransferDrawer key={`${view.id}:${view.mode ?? "view"}`} view={view} onClose={() => setView(undefined)} />
      ) : null}
    </div>
  );
};

const transferLineColumns = (product: (id: string) => string, batch: (id: string) => string): Column[] => [
  { key: "productId", label: "Product", render: (row) => product(text(row.productId, "")) },
  { key: "productBatchId", label: "Batch", render: (row) => batch(text(row.productBatchId, "")) },
  { key: "quantity", label: "Quantity", align: "right", render: (row) => formatQuantity(row.quantity) },
  {
    key: "shippedQuantity",
    hideBelow: "lg",
    label: "Shipped",
    align: "right",
    render: (row) => formatQuantity(row.shippedQuantity),
  },
  {
    key: "receivedQuantity",
    hideBelow: "lg",
    label: "Received",
    align: "right",
    render: (row) => formatQuantity(row.receivedQuantity),
  },
];

const TransferDrawer = ({ view, onClose }: { view: TransferView; onClose: () => void }): React.JSX.Element => {
  const detail = useQuery({
    queryKey: ["staff-inventory", "transfer", view.id],
    queryFn: () => readOne<JsonRecord>(`/api/inventory/transfers/${encodeURIComponent(view.id)}`),
  });
  const rawLines = detail.data?.lines;
  const lines = Array.isArray(rawLines) ? rawLines.map(asRecord) : [];
  const labels = useInventoryLabels(lines.map((line) => text(line.productId, "")));

  if (detail.error) {
    return (
      <EntityDrawer
        open
        onClose={onClose}
        title={translateText("Transfer")}
        details={<ListError error={detail.error} />}
      />
    );
  }
  if (detail.data === undefined) {
    return (
      <EntityDrawer open onClose={onClose} title={translateText("Transfer")} details={<Skeleton className="h-24" />} />
    );
  }
  const transfer = detail.data;
  if (view.mode !== undefined) {
    return (
      <TransferActionDrawer
        transfer={transfer}
        lines={lines}
        mode={view.mode}
        product={labels.product}
        batch={labels.batch}
        onClose={onClose}
      />
    );
  }
  return (
    <EntityDrawer
      open
      onClose={onClose}
      title={text(transfer.transferNumber, "-")}
      subtitle={translateText("Transfer")}
      status={{ label: translateText(text(transfer.status, "-")), tone: statusTone(text(transfer.status, "")) }}
      details={
        <div className="grid gap-4">
          <FactList>
            <Fact label="From">{labels.site(text(transfer.sourceSiteId, ""))}</Fact>
            <Fact label="To">{labels.site(text(transfer.destinationSiteId, ""))}</Fact>
            <Fact label="Created">{formatDateTime(transfer.createdAt)}</Fact>
          </FactList>
          <DataTable
            rows={lines}
            columns={transferLineColumns(labels.product, labels.batch)}
            getKey={(row) => text(row.id, "")}
            empty="No lines"
            interactive={false}
            virtualize={false}
          />
        </div>
      }
    />
  );
};

const TransferActionDrawer = ({
  transfer,
  lines,
  mode,
  product,
  batch,
  onClose,
}: {
  transfer: JsonRecord;
  lines: JsonRecord[];
  mode: "ship" | "receive";
  product: (id: string) => string;
  batch: (id: string) => string;
  onClose: () => void;
}): React.JSX.Element => {
  const confirmedAction = useConfirmedAction();
  const transferId = text(transfer.id, "");
  const form = useForm({
    defaultValues: {
      lines: lines.map((line) => ({
        transferOrderLineId: text(line.id, ""),
        quantity:
          mode === "ship"
            ? text(line.quantity, "0")
            : text(numberValue(line.shippedQuantity) - numberValue(line.receivedQuantity), "0"),
      })),
    },
    onSubmit: async ({ value }) => {
      const shipping = mode === "ship";
      const ok = await confirmedAction({
        title: shipping ? "Ship these quantities?" : "Receive these quantities?",
        description: "The transfer status changes after this step.",
        confirmLabel: shipping ? "Ship" : "Receive",
        path: `/api/inventory/transfers/${transferId}/${mode}`,
        body: {
          lines: value.lines.map((line) =>
            shipping
              ? { transferOrderLineId: line.transferOrderLineId, shippedQuantity: Number(line.quantity) }
              : { transferOrderLineId: line.transferOrderLineId, receivedQuantity: Number(line.quantity) },
          ),
        },
        success: shipping ? "Transfer shipped." : "Transfer received.",
      });
      if (ok) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const values = useStore(form.store, (state) => state.values);

  return (
    <FormDrawer
      title={mode === "ship" ? "Ship transfer lines" : "Receive transfer lines"}
      subtitle={text(transfer.transferNumber, "-")}
      formId="inventory-transfer-action"
      submitLabel={mode === "ship" ? "Ship selected quantities" : "Receive selected quantities"}
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      {values.lines.map((line, index) => {
        const source = lines[index];
        return (
          <LineCard key={line.transferOrderLineId} index={index}>
            <p className="text-sm text-muted sm:col-span-2">
              {product(text(source?.productId, ""))} · {batch(text(source?.productBatchId, ""))}
            </p>
            <form.Field name={`lines[${index}].quantity` as const}>
              {(field) => (
                <Field
                  label={mode === "ship" ? "Shipped quantity" : "Received quantity"}
                  type="number"
                  value={field.state.value}
                  onChange={field.handleChange}
                  required
                />
              )}
            </form.Field>
          </LineCard>
        );
      })}
    </FormDrawer>
  );
};
