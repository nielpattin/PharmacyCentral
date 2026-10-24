import { Button, RowActions } from "@pharmacy/ui";
import { useMemo, useRef, useState } from "react";

import { useConfirm, usePrompt } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { formatDate, formatQuantity, text, type JsonRecord } from "../../staff-api.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { MOVEMENT_HISTORY_COLUMNS } from "./movements.tsx";
import { statusTone } from "./status.ts";
import type { InventoryTab } from "./tabs.ts";
import {
  CreateAction,
  Fact,
  FactList,
  INVENTORY_INVALIDATE,
  ListError,
  ListToolbar,
  PAGE_SIZE,
  statusBadge,
  useFocusSearchHotkey,
} from "./shared.tsx";

const BALANCE_DEFAULTS = { q: "" } as const;
const BATCH_DEFAULTS = { q: "" } as const;

export const BalancesTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(BALANCE_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const list = usePagedList({
    key: ["staff-inventory", "balances"],
    path: "/api/inventory/balances",
    params: { q: values.q.trim() || undefined },
    limit: PAGE_SIZE,
  });
  // A balance row carries its batch fields alongside the balance, so both read from one object.
  const balances = useMemo(
    () => list.rows.map((row) => ({ ...asRecord(row.balance), ...asRecord(row.batch) })),
    [list.rows],
  );
  const labels = useInventoryLabels(balances.map((row) => text(row.productId, "")));

  const columns: Column[] = [
    {
      key: "productId",
      label: "Product",
      render: (row) => labels.product(text(row.productId, "")),
      text: (row) => labels.product(text(row.productId, "")),
      truncate: 32,
    },
    { key: "batchNumber", label: "Batch" },
    {
      key: "storageLocationId",
      label: "Location",
      render: (row) => labels.location(text(row.storageLocationId, "")),
      text: (row) => labels.location(text(row.storageLocationId, "")),
      truncate: 24,
    },
    { key: "quantityOnHand", label: "On hand", align: "right", render: (row) => formatQuantity(row.quantityOnHand) },
    {
      key: "quantityReserved",
      label: "Reserved",
      align: "right",
      render: (row) => formatQuantity(row.quantityReserved),
    },
    { key: "expiryDate", label: "Expiry", render: (row) => formatDate(row.expiryDate) },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <ListToolbar pageKey="inventory:balances" defaults={BALANCE_DEFAULTS} />
      <ListError error={list.error} />
      <DataTable
        rows={balances}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => `${text(row.id, "")}:${text(row.storageLocationId, "")}`}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by batch number") }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        storageKey="staff:inventory:balances"
        exportCsv={{ filename: "inventory-balances.csv" }}
      />
    </div>
  );
};

const BatchHistory = ({ batchId }: { batchId: string }): React.JSX.Element => {
  const history = usePagedList({
    key: ["staff-inventory", "batch-movements"],
    path: "/api/inventory/movements",
    params: { productBatchId: batchId },
    limit: PAGE_SIZE,
  });
  return (
    <div className="grid gap-3">
      <ListError error={history.error} />
      <DataTable
        rows={history.rows}
        columns={MOVEMENT_HISTORY_COLUMNS}
        loading={history.isLoading}
        getKey={(row) => text(row.id, "")}
        empty="No movements for this batch"
        interactive={false}
        virtualize={false}
        paging={{ hasMore: history.hasMore, loadingMore: history.isLoadingMore, onLoadMore: history.loadMore }}
      />
    </div>
  );
};

type QualityDecision = "release" | "reject";

export const BatchesTab = ({ onNavigate }: { onNavigate: (tab: InventoryTab) => void }): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(BATCH_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  useHotkey("n", () => onNavigate("Create batch"), { label: "Create new" });
  const list = usePagedList({
    key: ["staff-inventory", "batches"],
    path: "/api/inventory/batches",
    params: { q: values.q.trim() || undefined },
    limit: PAGE_SIZE,
  });
  const labels = useInventoryLabels(list.rows.map((row) => text(row.productId, "")));
  const run = useStaffAction();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = selectedId === undefined ? undefined : list.rows.find((row) => text(row.id, "") === selectedId);

  const quality = async (batch: JsonRecord, decision: QualityDecision): Promise<void> => {
    const release = decision === "release";
    const accepted = await confirm({
      title: release ? "Release this batch?" : "Reject this batch?",
      description: release
        ? "The batch quality status changes to Released."
        : "The batch quality status changes to Rejected.",
      confirmLabel: release ? "Release" : "Reject",
      tone: release ? "default" : "danger",
    });
    if (!accepted) return;
    const notes = await prompt({
      title: release ? "Release batch" : "Reject batch",
      label: "Quality review notes",
      confirmLabel: release ? "Release" : "Reject",
    });
    if (notes === null) return;
    await run({
      path: `/api/inventory/batches/${text(batch.id, "")}/quality`,
      body: { decision, notes: notes.trim() || null },
      invalidate: INVENTORY_INVALIDATE,
      success: release ? "Batch released." : "Batch rejected.",
    });
  };

  const columns: Column[] = [
    { key: "batchNumber", label: "Batch" },
    {
      key: "productId",
      label: "Product",
      render: (row) => labels.product(text(row.productId, "")),
      text: (row) => labels.product(text(row.productId, "")),
      truncate: 32,
    },
    {
      key: "qualityStatus",
      label: "Quality",
      render: (row) => statusBadge(text(row.qualityStatus, "-")),
      text: (row) => text(row.qualityStatus, "-"),
    },
    { key: "expiryDate", label: "Expiry", render: (row) => formatDate(row.expiryDate) },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      enableSorting: false,
      render: (row) => (
        <RowActions label={translateText("Actions")}>
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(text(row.id, ""))}>
            {translateText("View")}
          </Button>
          <Button size="sm" onClick={() => void quality(row, "release")}>
            {translateText("Release")}
          </Button>
          <Button size="sm" variant="danger-soft" onClick={() => void quality(row, "reject")}>
            {translateText("Reject")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create batch" onClick={() => onNavigate("Create batch")} />
      <ListToolbar pageKey="inventory:batches" defaults={BATCH_DEFAULTS} />
      <ListError error={list.error} />
      <DataTable
        rows={list.rows}
        columns={columns}
        loading={list.isLoading}
        getKey={(row) => text(row.id, "")}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by batch number") }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        storageKey="staff:inventory:batches"
      />
      {selected ? (
        <EntityDrawer
          open
          onClose={() => setSelectedId(undefined)}
          title={text(selected.batchNumber, "-")}
          subtitle={translateText("Product batch")}
          status={{
            label: translateText(text(selected.qualityStatus, "-")),
            tone: statusTone(text(selected.qualityStatus, "")),
          }}
          details={
            <FactList>
              <Fact label="Product">{labels.product(text(selected.productId, ""))}</Fact>
              <Fact label="Expiry date">{formatDate(selected.expiryDate)}</Fact>
              <Fact label="Manufactured date">{formatDate(selected.manufacturedDate)}</Fact>
              <Fact label="Manufacturer">{text(selected.manufacturer, "-")}</Fact>
              <Fact label="Quality notes">{text(selected.qualityNotes, "-")}</Fact>
            </FactList>
          }
          history={<BatchHistory batchId={text(selected.id, "")} />}
          footer={
            <>
              <Button size="sm" onClick={() => void quality(selected, "release")}>
                {translateText("Release")}
              </Button>
              <Button size="sm" variant="danger-soft" onClick={() => void quality(selected, "reject")}>
                {translateText("Reject")}
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
};
