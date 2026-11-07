import { Alert, Button, DataTable, RowActions, StatusBadge, type DataColumn } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { formatDateTime, idOf, text, type JsonRecord } from "../../staff-api.ts";
import { GoodsReceiptDrawer } from "./goods-receipt-drawer.tsx";
import { referenceName, shortId } from "./labels.ts";
import { GOODS_RECEIPTS_KEY } from "./query-keys.ts";

const LIST_DEFAULTS = { q: "" } as const;

export const GoodsReceiptsTab = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const references = useStaffReferences();
  const listRef = useRef<HTMLDivElement>(null);
  const [openId, setOpenId] = useState<string>();
  const [search, setSearch] = useSearchDraft(list.values.q, (value) => list.setValues({ q: value }));

  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      listRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );

  const receipts = usePagedList({
    key: GOODS_RECEIPTS_KEY,
    path: "/api/procurement/goods-receipts",
    params: { q: list.values.q || undefined },
    limit: 100,
  });

  const columns: Array<DataColumn<JsonRecord>> = [
    {
      key: "receiptNumber",
      label: translateText("Receipt number"),
      render: (row) => text(row.receiptNumber, "") || shortId(row.id),
      truncate: 24,
    },
    {
      key: "status",
      label: translateText("Status"),
      render: (row) => <StatusBadge tone="neutral">{translateText(text(row.status))}</StatusBadge>,
      text: (row) => translateText(text(row.status, "")),
    },
    {
      key: "siteId",
      hideBelow: "lg",
      label: translateText("Site"),
      render: (row) => referenceName(references.sites, row.siteId, ["code", "name"]),
      text: (row) => referenceName(references.sites, row.siteId, ["code", "name"]),
      truncate: 24,
    },
    {
      key: "supplierId",
      hideBelow: "md",
      label: translateText("Supplier"),
      render: (row) => referenceName(references.suppliers, row.supplierId, ["code", "name"]),
      text: (row) => referenceName(references.suppliers, row.supplierId, ["code", "name"]),
      truncate: 28,
    },
    { key: "receivedAt", label: translateText("Received"), render: (row) => formatDateTime(row.receivedAt) },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      render: (row) => (
        <RowActions label={text(row.receiptNumber, "") || shortId(row.id)}>
          <Button size="sm" variant="ghost" onClick={() => setOpenId(idOf(row))}>
            {translateText("View")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <div className="grid gap-3">
      {receipts.error ? <Alert variant="danger">{translateText(receipts.error.message)}</Alert> : null}
      <div ref={listRef}>
        <DataTable
          toolbarExtra={<SavedViewsMenu pageKey="goods-receipts" defaults={LIST_DEFAULTS} />}
          storageKey="staff:procurement:goods-receipts"
          labels={dataTableLabels()}
          rows={receipts.rows}
          columns={columns}
          getKey={(row) => idOf(row)}
          loading={receipts.isLoading}
          empty={translateText("No records found")}
          search={{ value: search, onChange: setSearch, placeholder: translateText("Search by receipt number") }}
          paging={receipts.paging}
          exportCsv={{ filename: "goods-receipts.csv" }}
        />
      </div>
      <GoodsReceiptDrawer
        receiptId={openId}
        summary={receipts.rows.find((row) => idOf(row) === openId)}
        onClose={() => setOpenId(undefined)}
      />
    </div>
  );
};
