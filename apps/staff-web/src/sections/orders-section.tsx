import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { RefreshButton, SubTabs } from "../components/forms.tsx";
import { referenceLabel } from "../hooks/useStaffReferences.ts";
import { translateText } from "../i18n.ts";
import { formatDateTime, formatQuantity, numberValue, readRows, text, type JsonRecord } from "../staff-api.ts";

const STATUS_TABS = ["All", "Pending", "Confirmed", "Preparing", "Ready", "Delivering", "Completed", "Cancelled"];

const shortCode = (id: unknown): string => text(id, "").slice(0, 8).toUpperCase();

/** An order's total is the subtotal the sales service priced plus the delivery fee it calculated. */
const orderTotal = (row: JsonRecord): number => numberValue(row.subtotal) + numberValue(row.deliveryFee);

/** Orders shoppers placed on the customer site, listed straight from the sales-service order store. */
export const OrdersSection = (): React.JSX.Element => {
  const [tab, setTab] = useState<string>("All");
  const [error, setError] = useState<string>();
  const ordersQuery = useQuery({
    queryKey: ["online-orders", tab],
    queryFn: () =>
      readRows(tab === "All" ? "/api/orders?limit=100" : `/api/orders?limit=100&status=${encodeURIComponent(tab)}`),
  });
  const storesQuery = useQuery({ queryKey: ["catalog-stores"], queryFn: () => readRows("/api/stores") });
  const orders = ordersQuery.data ?? [];
  const stores = storesQuery.data ?? [];
  const queryError = ordersQuery.error instanceof Error ? ordersQuery.error.message : undefined;
  const storesError = storesQuery.error instanceof Error ? storesQuery.error.message : undefined;
  const visibleError = error ?? queryError ?? storesError;

  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await ordersQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load online orders");
    }
  };

  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("Online orders")}</h1>
          <p className="page-subtitle">{translateText("Orders shoppers placed on the customer website.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      <SubTabs tabs={STATUS_TABS} active={tab} onChange={setTab} />
      <DataTable
        loading={ordersQuery.isPending && !ordersQuery.data}
        rows={orders}
        columns={[
          { key: "id", label: "Order", render: (row) => "#" + shortCode(row.id) },
          {
            key: "selectedStoreId",
            label: "Store",
            render: (row) => referenceLabel(stores, row.selectedStoreId, ["code", "name"]),
          },
          {
            key: "fulfillmentType",
            label: "Fulfillment",
            render: (row) => translateText(text(row.fulfillmentType) === "pickup" ? "Pickup" : "Delivery"),
          },
          {
            key: "status",
            label: "Status",
            render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
          },
          {
            key: "paymentStatus",
            label: "Payment",
            render: (row) => <span className="status-chip">{translateText(text(row.paymentStatus))}</span>,
          },
          {
            key: "total",
            label: "Total",
            render: (row) => `${formatQuantity(orderTotal(row))} ${text(row.currency, "VND")}`,
          },
          { key: "createdAt", label: "Placed", render: (row) => formatDateTime(row.createdAt) },
        ]}
      />
    </section>
  );
};
