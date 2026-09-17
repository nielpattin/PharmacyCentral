import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, RefreshButton, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { formatDateTime, readOne, readRows, text, type JsonRecord } from "../staff-api.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";

export const FinanceSection = ({
  initialTab = "Summary",
}: {
  initialTab?: "Summary" | "Reports";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [reportType, setReportType] = useState("sales");
  const [error, setError] = useState<string>();
  const mutation = useStaffMutation();
  const financeQuery = useQuery({
    queryKey: ["finance", reportType],
    queryFn: async () => {
      const [summary, invoices, reports] = await Promise.all([
        readOne<JsonRecord>("/api/finance/summary"),
        readRows("/api/payments/invoices"),
        readRows("/api/reports?reportType=" + encodeURIComponent(reportType) + "&limit=100"),
      ]);
      return { summary, invoices, reports };
    },
  });
  const summary = financeQuery.data?.summary;
  const invoices = financeQuery.data?.invoices ?? [];
  const reports = financeQuery.data?.reports ?? [];
  const queryError = financeQuery.error instanceof Error ? financeQuery.error.message : undefined;
  const visibleError = error ?? queryError;
  const confirmCash = async (id: string): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: `/api/payments/${id}/confirm-counter`,
        method: "POST",
        invalidate: [["finance"]],
      });
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to confirm payment");
    }
  };
  const refund = async (id: string): Promise<void> => {
    const reasonText = window.prompt(translateText("Refund reason:"), translateText("Operational correction"));
    if (!reasonText) return;
    try {
      await mutation.mutateAsync({
        path: `/api/payments/${id}/refund`,
        method: "POST",
        body: { reason: reasonText },
        invalidate: [["finance"]],
      });
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to refund payment");
    }
  };
  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await financeQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load finance");
    }
  };
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h1>{translateText("Finance and reporting")}</h1>
          <p className="page-subtitle">{translateText("Payment status, reconciliation, and operational reports.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      <SubTabs tabs={["Summary", "Invoices", "Reports"]} active={tab} onChange={setTab} />
      {tab === "Summary" ? (
        <>
          <dl className="dash-grid">
            {[
              ["Paid", summary?.paid ?? 0],
              ["Refunded", summary?.refunded ?? 0],
              ["Net", summary?.net ?? 0],
              ["Inventory value", summary?.inventoryValue ?? 0],
              ["Reserved value", summary?.reservedValue ?? 0],
              ["Missing prices", summary?.missingPriceCount ?? 0],
              ["Receipts", summary?.receiptQuantity ?? 0],
              ["Dispensed", summary?.dispensedQuantity ?? 0],
              ["Returns", summary?.returnQuantity ?? 0],
              ["Adjustments", summary?.adjustmentQuantity ?? 0],
              ["Transfer out", summary?.transferOutQuantity ?? 0],
              ["Transfer in", summary?.transferInQuantity ?? 0],
            ].map(([label, value]) => (
              <div className="dash-card" key={text(label)}>
                <dt>{text(label)}</dt>
                <dd>
                  {text(value)} {text(summary?.currency, "VND")}
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="section-title">{translateText("Inventory activity")}</h3>
          <DataTable
            loading={financeQuery.isPending && !financeQuery.data}
            rows={
              Array.isArray(summary?.activityLines)
                ? summary.activityLines.filter(
                    (value): value is JsonRecord => typeof value === "object" && value !== null,
                  )
                : []
            }
            columns={[
              { key: "activityType", label: "Activity" },
              { key: "count", label: "Count" },
              { key: "quantityIn", label: "Quantity in" },
              { key: "quantityOut", label: "Quantity out" },
              { key: "latestActivityAtUtc", label: "Latest", render: (row) => formatDateTime(row.latestActivityAtUtc) },
            ]}
          />
          <h3 className="section-title">{translateText("Inventory valuation")}</h3>
          <DataTable
            loading={financeQuery.isPending && !financeQuery.data}
            rows={
              Array.isArray(summary?.valuationLines)
                ? summary.valuationLines.filter(
                    (value): value is JsonRecord => typeof value === "object" && value !== null,
                  )
                : []
            }
            columns={[
              { key: "productName", label: "Product" },
              { key: "batchNumber", label: "Batch" },
              { key: "siteName", label: "Site" },
              { key: "quantityOnHand", label: "On hand" },
              { key: "valueOnHand", label: "Value" },
              { key: "priceStatus", label: "Price status" },
            ]}
          />
        </>
      ) : null}
      {tab === "Invoices" ? (
        <DataTable
          loading={financeQuery.isPending && !financeQuery.data}
          rows={invoices}
          columns={[
            { key: "id", label: "Invoice" },
            { key: "paymentCode", label: "Payment code" },
            { key: "orderId", label: "Order" },
            { key: "amount", label: "Amount" },
            {
              key: "status",
              label: "Status",
              render: (row) => <span className="status-chip">{translateText(text(row.status))}</span>,
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <a
                    className="text-link"
                    href={`/api/payments/${text(row.id)}/reconciliation`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {translateText("Reconciliation")}
                  </a>
                  {text(row.status) === "Pending" ? (
                    <button
                      className="primary-button small"
                      type="button"
                      onClick={() => void confirmCash(text(row.id))}
                    >
                      {translateText("Confirm cash")}
                    </button>
                  ) : null}
                  {text(row.status) === "Paid" ? (
                    <button className="danger-button" type="button" onClick={() => void refund(text(row.id))}>
                      {translateText("Refund")}
                    </button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Reports" ? (
        <>
          <div className="inline-filter">
            <Field label="Report type" value={reportType} onChange={setReportType} />
            <button className="primary-button" type="button" onClick={() => void load()}>
              {translateText("Run report")}
            </button>
          </div>
          <DataTable
            loading={financeQuery.isPending && !financeQuery.data}
            rows={reports}
            columns={[
              { key: "reportType", label: "Type" },
              { key: "subjectId", label: "Subject" },
              { key: "value", label: "Value" },
              { key: "occurredAt", label: "Occurred", render: (row) => formatDateTime(row.occurredAt) },
              { key: "payload", label: "Details", render: (row) => <code>{text(row.payload)}</code> },
            ]}
          />
        </>
      ) : null}
    </section>
  );
};
