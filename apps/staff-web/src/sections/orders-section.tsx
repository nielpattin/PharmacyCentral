import { useRef, useState } from "react";

import { Alert, Button, RowActions, StatusCell } from "@pharmacy/ui";

import { DataTable, type Column } from "../components/data-table.tsx";
import { EntityDrawer } from "../components/entity-drawer.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { usePagedList } from "../hooks/usePagedList.ts";
import { referenceLabel, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { SubTabs } from "../components/forms.tsx";
import { SavedViewsMenu } from "../components/saved-views-menu.tsx";
import { useSearchDraft } from "../hooks/useSearchDraft.ts";
import { useFocusSearchHotkey } from "../hooks/useFocusSearchHotkey.ts";
import { translateText } from "../i18n.ts";
import { formatDateTime, numberValue, text, type JsonRecord } from "../staff-api.ts";
import {
  ALL_STATUSES,
  activeStatus,
  formatAmount,
  ORDER_STATUSES,
  orderTone,
  queryParam,
  shortId,
  statusParam,
} from "./sales/rules.ts";
import { OrderActions } from "./sales/order-actions.tsx";
import { DetailField, moneyLocale, SalesAuditHistory } from "./sales/shared.tsx";

const ORDERS_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

/** An order's total is the subtotal the sales service priced plus the delivery fee it calculated. */
const orderTotal = (row: JsonRecord): number => numberValue(row.subtotal) + numberValue(row.deliveryFee);

const orderCode = (row: JsonRecord): string => `#${shortId(row.id).toUpperCase()}`;

/**
 * Orders shoppers placed on the customer site, newest first. The search matches the order id only: sales-service stores
 * no customer name. Opening an order shows its details and its audit history, and a Pharmacist or Pharmacy Manager
 * processes it from the drawer (`OrderActions`).
 */
export const OrdersSection = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(ORDERS_DEFAULTS);
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const status = activeStatus(values.status, ORDER_STATUSES, ALL_STATUSES);
  const orders = usePagedList({
    key: ["staff-orders"],
    path: "/api/orders",
    params: { status: statusParam(status), q: queryParam(values.q) },
    limit: 100,
  });
  const references = useStaffReferences();
  const [openId, setOpenId] = useState<string>();
  const openRow = orders.rows.find((row) => text(row.id, "") === openId);

  const columns: Column[] = [
    { key: "id", label: "Order", render: (row) => orderCode(row) },
    {
      key: "selectedStoreId",
      hideBelow: "lg",
      label: "Store",
      truncate: true,
      render: (row) => referenceLabel(references.sites, row.selectedStoreId, ["code", "name"]),
      text: (row) => referenceLabel(references.sites, row.selectedStoreId, ["code", "name"]),
    },
    {
      key: "fulfillmentType",
      hideBelow: "md",
      label: "Fulfillment",
      render: (row) => translateText(text(row.fulfillmentType, "") === "pickup" ? "Pickup" : "Delivery"),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <StatusCell tone={orderTone(text(row.status, ""))}>{translateText(text(row.status, "-"))}</StatusCell>
      ),
    },
    {
      key: "paymentStatus",
      hideBelow: "md",
      label: "Payment",
      render: (row) => translateText(text(row.paymentStatus, "-")),
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (row) => formatAmount(orderTotal(row), row.currency, moneyLocale()),
    },
    { key: "createdAt", hideBelow: "xl", label: "Placed", render: (row) => formatDateTime(row.createdAt) },
    {
      key: "actions",
      label: "Actions",
      enableSorting: false,
      pinned: "right",
      render: (row) => (
        <RowActions label={translateText("Order actions")}>
          <Button variant="ghost" size="sm" onClick={() => setOpenId(text(row.id, ""))}>
            {translateText("View")}
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <section ref={rootRef} className="grid gap-3">
      <SubTabs
        tabs={[...ORDER_STATUSES]}
        active={status}
        onChange={(next) => setValues({ status: next }, { history: "push" })}
      />
      {orders.error ? <Alert variant="danger">{translateText(orders.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:sales:orders"
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by order ID") }}
        toolbarExtra={<SavedViewsMenu pageKey="orders" defaults={ORDERS_DEFAULTS} />}
        loading={orders.isLoading}
        rows={orders.rows}
        columns={columns}
        paging={{ hasMore: orders.hasMore, loadingMore: orders.isLoadingMore, onLoadMore: orders.loadMore }}
        exportCsv={{ filename: "online-orders.csv" }}
      />
      <EntityDrawer
        open={openRow !== undefined}
        onClose={() => setOpenId(undefined)}
        title={openRow ? orderCode(openRow) : ""}
        subtitle={translateText("Online order")}
        {...(openRow
          ? { status: { label: translateText(text(openRow.status, "-")), tone: orderTone(text(openRow.status, "")) } }
          : {})}
        details={
          openRow ? (
            <div className="grid gap-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailField
                  label="Store"
                  value={referenceLabel(references.sites, openRow.selectedStoreId, ["code", "name"])}
                />
                <DetailField
                  label="Fulfillment"
                  value={translateText(text(openRow.fulfillmentType, "") === "pickup" ? "Pickup" : "Delivery")}
                />
                <DetailField label="Payment" value={translateText(text(openRow.paymentStatus, "-"))} />
                <DetailField label="Total" value={formatAmount(orderTotal(openRow), openRow.currency, moneyLocale())} />
                <DetailField label="Placed" value={formatDateTime(openRow.createdAt)} />
              </dl>
              <OrderActions order={openRow} />
            </div>
          ) : null
        }
        history={openRow ? <SalesAuditHistory entityType="order" entityId={text(openRow.id, "")} /> : undefined}
      />
    </section>
  );
};
