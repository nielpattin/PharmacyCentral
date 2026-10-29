import { Button, RowActions } from "@pharmacy/ui";
import { useMemo, useRef, useState } from "react";

import { useConfirm, usePrompt } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { withActionColumn } from "../../lib/action-column.ts";
import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { GatedButton } from "../../components/gated-button.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { translateText } from "../../i18n.ts";
import { useCan } from "../../permissions/use-can.ts";
import { formatDate, formatQuantity, numberValue, text, type JsonRecord } from "../../staff-api.ts";
import { CreatePlanDrawer } from "../action-plans/create-plan-drawer.tsx";
import { expiringBatchDraft, type ActionPlanDraft } from "../action-plans/drafts.ts";
import { expiryState, isIsoDate, todayIsoDate } from "../action-plans/plan-state.ts";
import { asRecord } from "./format.ts";
import { useInventoryLabels } from "./labels.ts";
import { MOVEMENT_HISTORY_COLUMNS } from "./movements.tsx";
import { qualityDecisionsFor, statusTone, type QualityDecision } from "./status.ts";
import { CreateBatchDrawer } from "./create-batch.tsx";
import { Fact, FactList, INVENTORY_INVALIDATE, ListError, PAGE_SIZE, statusBadge } from "./shared.tsx";
import { CreateAction } from "../../components/form-parts.tsx";

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
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();
  const today = todayIsoDate();

  const canPlanRow = (row: JsonRecord): boolean => {
    const expiryDate = text(row.expiryDate, "").slice(0, 10);
    const expiring = isIsoDate(expiryDate) && expiryState(expiryDate, today) !== "ok";
    return planGate.allowed && expiring && numberValue(row.quantityOnHand) > 0;
  };

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
      hideBelow: "lg",
      label: "Location",
      render: (row) => labels.location(text(row.storageLocationId, "")),
      text: (row) => labels.location(text(row.storageLocationId, "")),
      truncate: 24,
    },
    { key: "quantityOnHand", label: "On hand", align: "right", render: (row) => formatQuantity(row.quantityOnHand) },
    {
      key: "quantityReserved",
      hideBelow: "md",
      label: "Reserved",
      align: "right",
      render: (row) => formatQuantity(row.quantityReserved),
    },
    { key: "expiryDate", label: "Expiry", render: (row) => formatDate(row.expiryDate) },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      align: "right",
      enableSorting: false,
      render: (row) => {
        const expiryDate = text(row.expiryDate, "").slice(0, 10);
        const quantityOnHand = numberValue(row.quantityOnHand);
        if (!canPlanRow(row)) return null;
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setPlanDraft(
                expiringBatchDraft({
                  siteId: text(row.siteId, ""),
                  batchId: text(row.id, ""),
                  productId: text(row.productId, ""),
                  productName: labels.product(text(row.productId, "")),
                  batchNumber: text(row.batchNumber, ""),
                  expiryDate,
                  quantityOnHand,
                  today,
                }),
              )
            }
          >
            {translateText("Create plan")}
          </Button>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <ListError error={list.error} />
      <DataTable
        toolbarExtra={<SavedViewsMenu pageKey="inventory:balances" defaults={BALANCE_DEFAULTS} />}
        rows={balances}
        columns={withActionColumn(columns, balances.some(canPlanRow))}
        loading={list.isLoading}
        getKey={(row) => `${text(row.id, "")}:${text(row.storageLocationId, "")}`}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by batch number") }}
        paging={{ hasMore: list.hasMore, loadingMore: list.isLoadingMore, onLoadMore: list.loadMore }}
        storageKey="staff:inventory:balances"
        exportCsv={{ filename: "inventory-balances.csv" }}
      />
      {planDraft ? <CreatePlanDrawer draft={planDraft} onClose={() => setPlanDraft(undefined)} /> : null}
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

export const BatchesTab = (): React.JSX.Element => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { values, setValues } = useListUrlState(BATCH_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const createGate = useCan("inventory.batch.create");
  const [creating, setCreating] = useState(false);
  useHotkey("n", () => setCreating(true), { label: "Create new", when: createGate.allowed && !creating });
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
  const reviewGate = useCan("inventory.batch.quality");
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
      truncate: 56,
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
      align: "right",
      width: 220,
      enableSorting: false,
      render: (row) => {
        const decisions = qualityDecisionsFor(text(row.qualityStatus, ""));
        return (
          <RowActions label={translateText("Actions")}>
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(text(row.id, ""))}>
              {translateText("View")}
            </Button>
            {decisions.includes("release") ? (
              <GatedButton gate={reviewGate} size="sm" variant="secondary" onClick={() => void quality(row, "release")}>
                {translateText("Release")}
              </GatedButton>
            ) : null}
            {decisions.includes("reject") ? (
              <GatedButton
                gate={reviewGate}
                size="sm"
                variant="danger-ghost"
                onClick={() => void quality(row, "reject")}
              >
                {translateText("Reject")}
              </GatedButton>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <CreateAction label="Create batch" gate={createGate} onClick={() => setCreating(true)} />
      <ListError error={list.error} />
      <DataTable
        toolbarExtra={<SavedViewsMenu pageKey="inventory:batches" defaults={BATCH_DEFAULTS} />}
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
              {qualityDecisionsFor(text(selected.qualityStatus, "")).includes("release") ? (
                <GatedButton gate={reviewGate} size="sm" onClick={() => void quality(selected, "release")}>
                  {translateText("Release")}
                </GatedButton>
              ) : null}
              {qualityDecisionsFor(text(selected.qualityStatus, "")).includes("reject") ? (
                <GatedButton
                  gate={reviewGate}
                  size="sm"
                  variant="danger-ghost"
                  onClick={() => void quality(selected, "reject")}
                >
                  {translateText("Reject")}
                </GatedButton>
              ) : null}
            </>
          }
        />
      ) : null}
      {creating ? <CreateBatchDrawer onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
