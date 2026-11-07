import { Alert, Button, Dialog, RowActions, useToast } from "@pharmacy/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { CreateAction } from "../../components/form-parts.tsx";
import { Field, SelectField } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { loadProducts } from "../../hooks/useProductLookup.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { withActionColumn } from "../../lib/action-column.ts";
import { useSession } from "../../auth.ts";
import { can, ownerOf } from "../../permissions/staff-permissions.ts";
import { useCan } from "../../permissions/use-can.ts";
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  numberValue,
  requestPage,
  text,
  type JsonRecord,
} from "../../staff-api.ts";
import { printDisposalSlip, type DisposalSlipData } from "./disposal-slip.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { ALL_STATUSES, DISPOSAL_STATUSES, statusParam } from "./status.ts";
import {
  INVENTORY_INVALIDATE,
  ListError,
  PAGE_SIZE,
  StatusFilter,
  statusBadge,
  useConfirmedAction,
} from "./shared.tsx";

const DISPOSAL_DEFAULTS = { q: "", status: ALL_STATUSES } as const;
const REASONS = ["Expired", "Damaged", "Recalled", "Other"] as const;

const linesOf = (row: JsonRecord): JsonRecord[] =>
  Array.isArray(row.lines) ? row.lines.map((line) => asRecord(line)) : [];

const totalOf = (row: JsonRecord): number => linesOf(row).reduce((sum, line) => sum + numberValue(line.quantity), 0);

const batchNumbersOf = (row: JsonRecord): string =>
  linesOf(row)
    .map((line) => text(line.batchNumber, "-"))
    .join(", ");

/** Proposes a disposal at one site: the batch picker lists that site's stock, soonest expiry first. */
const CreateDisposalDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const run = useStaffAction();
  const session = useSession();
  const references = useStaffReferences();
  const [siteId, setSiteId] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("Expired");
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const allowedSites = useMemo(
    () =>
      session.siteIds === undefined
        ? references.sites
        : references.sites.filter((row) => (session.siteIds ?? []).includes(text(row.id, ""))),
    [references.sites, session.siteIds],
  );
  const chosenSite = siteId !== "" ? siteId : text(allowedSites[0]?.id ?? "", "");

  // The middleware narrows the list to `siteId` when it is one of the caller's sites.
  const balances = useQuery({
    queryKey: ["staff-inventory", "disposals", "balances", chosenSite],
    queryFn: () =>
      requestPage(
        `/api/inventory/balances?siteId=${encodeURIComponent(chosenSite)}&includeZeroBalances=false&limit=${PAGE_SIZE}`,
      ),
    enabled: chosenSite !== "",
  });
  const rows = useMemo(
    () =>
      (balances.data?.rows ?? [])
        .map((row) => ({ ...asRecord(row.balance), ...asRecord(row.batch) }))
        .filter((row) => numberValue(row.quantityOnHand) - numberValue(row.quantityReserved) > 0),
    [balances.data],
  );
  const labels = useInventoryLabels(rows.map((row) => text(row.productId, "")));
  const availableOf = (row: JsonRecord): number => numberValue(row.quantityOnHand) - numberValue(row.quantityReserved);

  const toggle = (row: JsonRecord, selected: boolean): void => {
    const id = text(row.id, "");
    setChosen((current) => {
      if (!selected) {
        const { [id]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [id]: String(availableOf(row)) };
    });
  };

  const submit = async (): Promise<void> => {
    const selected = rows.filter((row) => Object.hasOwn(chosen, text(row.id, "")));
    if (chosenSite === "" || selected.length === 0) {
      setFormError("Choose at least one batch.");
      return;
    }
    for (const row of selected) {
      const quantity = Number(chosen[text(row.id, "")]);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > availableOf(row)) {
        setFormError("A disposal quantity must be positive and no more than the available stock.");
        return;
      }
    }
    const ok = await run({
      path: "/api/inventory/disposals",
      body: {
        siteId: chosenSite,
        reason,
        note: note.trim() || null,
        lines: selected.map((row) => ({
          productBatchId: text(row.productBatchId, ""),
          storageLocationId: text(row.storageLocationId, ""),
          quantity: Number(chosen[text(row.id, "")]),
        })),
      },
      invalidate: INVENTORY_INVALIDATE,
      success: "Disposal record submitted for approval.",
    });
    if (ok) onClose();
  };

  return (
    <FormDrawer
      title="Create disposal record"
      width="xl"
      formId="inventory-disposal-form"
      submitLabel="Submit for approval"
      isDirty={Object.keys(chosen).length > 0 || note.trim() !== ""}
      onSubmit={() => void submit()}
      onClose={onClose}
    >
      {formError !== "" ? (
        <div className="sm:col-span-2">
          <Alert variant="danger">{translateText(formError)}</Alert>
        </div>
      ) : null}
      {balances.error ? (
        <div className="sm:col-span-2">
          <Alert variant="danger">{translateText(balances.error.message)}</Alert>
        </div>
      ) : null}
      <SelectField
        label="Site"
        value={chosenSite}
        onChange={(value) => {
          setSiteId(value);
          setChosen({});
          setFormError("");
        }}
        options={referenceOptions(allowedSites, ["code", "name"])}
        required
      />
      <SelectField
        label="Disposal reason"
        value={reason}
        onChange={(value) => setReason(value as (typeof REASONS)[number])}
        options={REASONS.map((value) => ({ value, label: translateText(value) }))}
        required
      />
      <Field label="Notes" value={note} onChange={setNote} />
      <div className="grid gap-2 sm:col-span-2">
        <span className="text-sm font-medium text-ink">{translateText("Batches at this site")}</span>
        <div className="max-h-72 overflow-auto rounded-md border border-line">
          {balances.isPending && chosenSite !== "" ? (
            <p className="p-3 text-sm text-muted">{translateText("Loading…")}</p>
          ) : rows.length === 0 ? (
            <p className="p-3 text-sm text-muted">{translateText("This site has no batches with stock.")}</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="w-10 p-2" aria-label={translateText("Choose this batch")} />
                  <th className="p-2">{translateText("Product")}</th>
                  <th className="whitespace-nowrap p-2">{translateText("Batch")}</th>
                  <th className="whitespace-nowrap p-2">{translateText("Location")}</th>
                  <th className="whitespace-nowrap p-2">{translateText("Expiry")}</th>
                  <th className="whitespace-nowrap p-2 text-right">{translateText("Available")}</th>
                  <th className="whitespace-nowrap p-2 text-right">{translateText("Quantity")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = text(row.id, "");
                  const selected = Object.hasOwn(chosen, id);
                  return (
                    <tr key={id} className="border-b border-line/60 last:border-0">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={translateText("Choose this batch")}
                          checked={selected}
                          onChange={(event) => toggle(row, event.target.checked)}
                        />
                      </td>
                      <td className="max-w-52 truncate p-2" title={labels.product(text(row.productId, ""))}>
                        {labels.product(text(row.productId, ""))}
                      </td>
                      <td className="whitespace-nowrap p-2">{text(row.batchNumber, "-")}</td>
                      <td className="whitespace-nowrap p-2">{labels.location(text(row.storageLocationId, ""))}</td>
                      <td className="whitespace-nowrap p-2">{formatDate(row.expiryDate)}</td>
                      <td className="whitespace-nowrap p-2 text-right">{formatQuantity(availableOf(row))}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="w-20 rounded border border-line bg-surface px-2 py-1 text-right text-sm"
                          aria-label={translateText("Quantity")}
                          disabled={!selected}
                          value={selected ? chosen[id] : ""}
                          onChange={(event) => setChosen((current) => ({ ...current, [id]: event.target.value }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </FormDrawer>
  );
};

const DisposalSlipDialog = ({
  record,
  onClose,
  onPrint,
  labels,
}: {
  record: JsonRecord | undefined;
  onClose: () => void;
  onPrint: (record: JsonRecord) => void;
  labels: ReturnType<typeof useInventoryLabels>;
}): React.JSX.Element => (
  <Dialog open={record !== undefined} onClose={onClose} title={translateText("Disposal slip")} className="max-w-3xl">
    {record ? (
      <div className="grid gap-3 overflow-auto text-sm">
        <dl className="grid grid-cols-[10rem_1fr] gap-1">
          <dt className="text-muted">{translateText("Site")}</dt>
          <dd>{labels.site(text(record.siteId, ""))}</dd>
          <dt className="text-muted">{translateText("Reason")}</dt>
          <dd>{translateText(text(record.reason, "-"))}</dd>
          <dt className="text-muted">{translateText("Notes")}</dt>
          <dd>{text(record.note, "-")}</dd>
          <dt className="text-muted">{translateText("Created")}</dt>
          <dd>{formatDateTime(record.createdAt)}</dd>
          <dt className="text-muted">{translateText("Approved at")}</dt>
          <dd>{formatDateTime(record.decidedAt)}</dd>
        </dl>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="p-2">{translateText("Product")}</th>
              <th className="p-2">{translateText("Batch")}</th>
              <th className="p-2">{translateText("Location")}</th>
              <th className="p-2 text-right">{translateText("Quantity")}</th>
            </tr>
          </thead>
          <tbody>
            {linesOf(record).map((line) => (
              <tr key={text(line.id, "")} className="border-b border-line/60 last:border-0">
                <td className="p-2">{labels.product(text(line.productId, ""))}</td>
                <td className="p-2">{text(line.batchNumber, "-")}</td>
                <td className="p-2">{labels.location(text(line.storageLocationId, ""))}</td>
                <td className="p-2 text-right">{formatQuantity(line.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {translateText("Close")}
          </Button>
          <Button onClick={() => onPrint(record)}>{translateText("Print slip")}</Button>
        </div>
      </div>
    ) : null}
  </Dialog>
);

export const DisposalsTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(DISPOSAL_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const createGate = useCan("inventory.disposal.create");
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate.allowed && !creating });
  const [slip, setSlip] = useState<JsonRecord>();
  const session = useSession();
  const toast = useToast();
  const list = usePagedList({
    key: ["staff-inventory", "disposals"],
    path: "/api/inventory/disposals",
    params: { q: values.q.trim() || undefined, status: statusParam(values.status) },
    limit: PAGE_SIZE,
    prepareExport: (rows) => loadProducts(rows.flatMap((row) => linesOf(row).map((line) => text(line.productId, "")))),
  });
  const labels = useInventoryLabels(list.rows.flatMap((row) => linesOf(row).map((line) => text(line.productId, ""))));

  const confirmedAction = useConfirmedAction();
  const transition = async (row: JsonRecord, action: "approve" | "reject"): Promise<void> => {
    const approve = action === "approve";
    await confirmedAction({
      title: approve ? "Approve this disposal record?" : "Reject this disposal record?",
      description: approve
        ? "Approval takes the batches off the shelf and cannot be undone from this screen."
        : "The record will not change stock.",
      confirmLabel: approve ? "Approve" : "Reject",
      tone: approve ? "default" : "danger",
      path: `/api/inventory/disposals/${text(row.id, "")}/${action}`,
      success: approve ? "Disposal record approved." : "Disposal record rejected.",
    });
  };

  const canDecideRow = (row: JsonRecord): boolean =>
    text(row.status, "") === "PendingApproval" &&
    can("inventory.disposal.decide", session, ownerOf(row.createdBy)).allowed;
  const canPrintRow = (row: JsonRecord): boolean => text(row.status, "") === "Approved";
  const canActRow = (row: JsonRecord): boolean => canDecideRow(row) || canPrintRow(row);

  const print = (record: JsonRecord): void => {
    const data: DisposalSlipData = {
      id: text(record.id, ""),
      site: labels.site(text(record.siteId, "")),
      reason: translateText(text(record.reason, "-")),
      note: text(record.note, ""),
      createdAt: text(record.createdAt, ""),
      decidedAt: text(record.decidedAt, ""),
      lines: linesOf(record).map((line) => ({
        product: labels.product(text(line.productId, "")),
        batch: text(line.batchNumber, "-"),
        location: labels.location(text(line.storageLocationId, "")),
        quantity: numberValue(line.quantity),
      })),
    };
    if (!printDisposalSlip(data)) toast.info(translateText("Allow pop-ups to print the disposal slip."));
  };

  const columns: Column[] = [
    {
      key: "createdAt",
      label: "Created",
      render: (row) => formatDateTime(row.createdAt),
      text: (row) => formatDateTime(row.createdAt),
    },
    { key: "reason", label: "Reason", render: (row) => translateText(text(row.reason, "-")) },
    {
      key: "batches",
      hideBelow: "lg",
      label: "Batches",
      render: (row) => batchNumbersOf(row),
      text: (row) => batchNumbersOf(row),
      truncate: 32,
    },
    {
      key: "quantity",
      label: "Total quantity",
      align: "right",
      render: (row) => formatQuantity(totalOf(row)),
      text: (row) => formatQuantity(totalOf(row)),
    },
    { key: "status", label: "Status", render: (row) => statusBadge(text(row.status, "-")) },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => {
        if (!canActRow(row)) return null;
        const owner = ownerOf(row.createdBy);
        return (
          <RowActions label={translateText("Actions")}>
            {canDecideRow(row) ? (
              <>
                <Button size="sm" onClick={() => void transition(row, "approve")}>
                  {translateText("Approve")}
                </Button>
                <Button size="sm" variant="danger-ghost" onClick={() => void transition(row, "reject")}>
                  {translateText("Reject")}
                </Button>
              </>
            ) : null}
            {canPrintRow(row) ? (
              <Button size="sm" variant="outline" onClick={() => setSlip(row)}>
                {translateText("Print slip")}
              </Button>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create disposal record" gate={createGate} onClick={() => setCreating(true)} />
      <ListError error={list.error} />
      <DataTable
        toolbarStart={
          <StatusFilter
            value={values.status}
            options={DISPOSAL_STATUSES}
            onChange={(status) => setValues({ status })}
          />
        }
        rows={list.rows}
        columns={withActionColumn(columns, list.rows.some(canActRow))}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{
          value: draft,
          onChange: setDraft,
          placeholder: translateText("Search by reason, note or batch number"),
        }}
        paging={list.paging}
        storageKey="staff:inventory:disposals"
        exportCsv={{ filename: "inventory-disposals.csv" }}
      />
      {creating ? <CreateDisposalDrawer onClose={() => setCreating(false)} /> : null}
      <DisposalSlipDialog record={slip} onClose={() => setSlip(undefined)} onPrint={print} labels={labels} />
    </div>
  );
};
