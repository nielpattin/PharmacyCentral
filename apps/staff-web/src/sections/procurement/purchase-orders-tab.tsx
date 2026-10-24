import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DataTable, RowActions, Select, StatusBadge, useToast, type DataColumn } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { dataTableLabels } from "../../components/data-table-labels.ts";
import { GatedButton } from "../../components/gated-button.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { useCan } from "../../permissions/use-can.ts";
import { formatDate, formatDateTime, idOf, text, writeJson, type JsonRecord } from "../../staff-api.ts";
import { fillText, summarizeBulk, type BulkOutcome } from "./bulk-summary.ts";
import { referenceName } from "./labels.ts";
import { PurchaseOrderDrawer } from "./purchase-order-drawer.tsx";
import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDERS_KEY,
  canApprovePurchaseOrder,
  canCancelPurchaseOrder,
  purchaseOrderActionPath,
  purchaseOrderNumber,
  purchaseOrderTone,
  usePurchaseOrderActions,
} from "./purchase-order-actions.ts";

const LIST_DEFAULTS = { q: "", status: "all" } as const;

export const PurchaseOrdersTab = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const references = useStaffReferences();
  const actions = usePurchaseOrderActions();
  const approveGate = useCan("purchaseOrder.approve");
  const cancelGate = useCan("purchaseOrder.cancel");
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useSearchDraft(list.values.q, (value) => {
    setSelected(new Set());
    list.setValues({ q: value });
  });

  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      listRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );

  const orders = usePagedList({
    key: PURCHASE_ORDERS_KEY,
    path: "/api/procurement/purchase-orders",
    params: {
      status: list.values.status === "all" ? undefined : list.values.status,
      q: list.values.q || undefined,
    },
    limit: 100,
  });

  const approveSelected = async (): Promise<void> => {
    const chosen = orders.rows.filter((row) => selected.has(idOf(row)));
    if (chosen.length === 0) return;
    const accepted = await confirm({
      title: "Approve the selected purchase orders?",
      description: "Only draft orders can be approved. The others are reported and left unchanged.",
      confirmLabel: "Approve",
    });
    if (!accepted) return;

    setBulkBusy(true);
    const outcomes: BulkOutcome[] = [];
    for (const row of chosen) {
      const label = purchaseOrderNumber(row);
      try {
        await writeJson(purchaseOrderActionPath(row.id), "POST", { action: "approve" });
        outcomes.push({ label, ok: true });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "The request failed.";
        outcomes.push({ label, ok: false, message: translateText(message) });
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: PURCHASE_ORDERS_KEY });

    const summary = summarizeBulk(outcomes);
    const headline = fillText(translateText("{done} of {total} purchase orders approved."), {
      done: summary.done,
      total: summary.total,
    });
    if (summary.failed.length === 0) {
      toast.success(headline);
      return;
    }
    const failures = summary.failed.map((failure) => `${failure.label} (${failure.message})`).join(", ");
    toast.error(`${headline} ${fillText(translateText("Not approved: {list}."), { list: failures })}`);
  };

  const columns: Array<DataColumn<JsonRecord>> = [
    {
      key: "purchaseOrderNumber",
      label: translateText("Number"),
      render: (row) => purchaseOrderNumber(row),
      truncate: 24,
    },
    {
      key: "status",
      label: translateText("Status"),
      render: (row) => (
        <StatusBadge tone={purchaseOrderTone(row.status)}>{translateText(text(row.status))}</StatusBadge>
      ),
      text: (row) => text(row.status, ""),
    },
    {
      key: "siteId",
      label: translateText("Site"),
      render: (row) => referenceName(references.sites, row.siteId, ["code", "name"]),
      text: (row) => referenceName(references.sites, row.siteId, ["code", "name"]),
      truncate: 24,
    },
    {
      key: "supplierId",
      label: translateText("Supplier"),
      render: (row) => referenceName(references.suppliers, row.supplierId, ["code", "name"]),
      text: (row) => referenceName(references.suppliers, row.supplierId, ["code", "name"]),
      truncate: 28,
    },
    { key: "expectedDate", label: translateText("Expected date"), render: (row) => formatDate(row.expectedDate) },
    { key: "createdAt", label: translateText("Created"), render: (row) => formatDateTime(row.createdAt) },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      render: (row) => (
        <RowActions label={purchaseOrderNumber(row)}>
          <Button size="sm" variant="ghost" onClick={() => setOpenId(idOf(row))}>
            {translateText("View")}
          </Button>
          {approveGate.allowed && canApprovePurchaseOrder(row.status) ? (
            <Button size="sm" onClick={() => void actions.approve(row)}>
              {translateText("Approve")}
            </Button>
          ) : null}
          {cancelGate.allowed && canCancelPurchaseOrder(row.status) ? (
            <Button size="sm" variant="danger-soft" onClick={() => void actions.cancel(row)}>
              {translateText("Cancel")}
            </Button>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={translateText("Status")}
          className="w-auto min-w-44"
          value={list.values.status}
          onChange={(event) => {
            setSelected(new Set());
            list.setValues({ status: event.target.value });
          }}
        >
          <option value="all">{translateText("All statuses")}</option>
          {PURCHASE_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {translateText(status)}
            </option>
          ))}
        </Select>
        <SavedViewsMenu pageKey="purchase-orders" defaults={LIST_DEFAULTS} />
      </div>
      {orders.error ? <Alert variant="danger">{translateText(orders.error.message)}</Alert> : null}
      <div ref={listRef}>
        <DataTable
          storageKey="staff:procurement:purchase-orders"
          labels={dataTableLabels()}
          rows={orders.rows}
          columns={columns}
          getKey={(row) => idOf(row)}
          loading={orders.isLoading}
          empty={translateText("No records found")}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: translateText("Search by purchase order number"),
          }}
          paging={{ hasMore: orders.hasMore, loadingMore: orders.isLoadingMore, onLoadMore: orders.loadMore }}
          selection={{ keys: selected, onChange: setSelected }}
          bulkActions={
            <GatedButton gate={approveGate} size="sm" disabled={bulkBusy} onClick={() => void approveSelected()}>
              {translateText("Approve selected")}
            </GatedButton>
          }
          exportCsv={{ filename: "purchase-orders.csv" }}
        />
      </div>
      <PurchaseOrderDrawer
        orderId={openId}
        summary={orders.rows.find((row) => idOf(row) === openId)}
        onClose={() => setOpenId(undefined)}
      />
    </div>
  );
};
