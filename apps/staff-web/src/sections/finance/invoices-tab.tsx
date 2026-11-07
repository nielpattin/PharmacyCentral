import {
  Alert,
  Button,
  DataTable,
  RowActions,
  Select,
  StatusBadge,
  type DataColumn,
  type StatusTone,
} from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useConfirm } from "../../components/confirm.tsx";
import { dataTableLabels } from "../../components/data-table-labels.ts";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { loadRecordLabels, useRecordLabels } from "../../hooks/useRecordLabels.ts";
import { useCan } from "../../permissions/use-can.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { customerLabel, orderLabel, shortId } from "../procurement/labels.ts";
import { formatDateTime, idOf, text, type JsonRecord } from "../../staff-api.ts";
import { formatAmount, isCounterInvoice } from "../sales/rules.ts";
import { moneyLocale } from "../sales/shared.tsx";
import { ReconciliationDrawer } from "./reconciliation-drawer.tsx";
import { useRefundRequest } from "./refund-request.ts";
import { FINANCE_SUMMARY_KEY, INVOICES_KEY } from "./query-keys.ts";

const LIST_DEFAULTS = { q: "", status: "all" } as const;

const INVOICE_STATUSES = ["Pending", "Paid", "Failed", "Refunded", "Cancelled"] as const;

const INVOICE_TONE: Readonly<Record<string, StatusTone | undefined>> = {
  Pending: "warning",
  Paid: "success",
  Failed: "danger",
  Refunded: "info",
  Cancelled: "neutral",
};

/**
 * Payment invoices, newest first. A Pharmacist confirms cash here. A Pharmacy Manager refunds the invoice of an online
 * order; a counter invoice is refunded by a Pharmacist from the counter payments list, so no refund shows for it here.
 * Platform Admin reads the list and acts on nothing, as the payment routes allow.
 */
export const InvoicesTab = (): React.JSX.Element => {
  const confirmGate = useCan("payment.confirmCash");
  const refundGate = useCan("payment.refund");
  const customerGate = useCan("customer.lookup");
  const list = useListUrlState(LIST_DEFAULTS);
  const run = useStaffAction();
  const confirm = useConfirm();
  const askRefund = useRefundRequest("Operational correction");
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useSearchDraft(list.values.q, (value) => list.setValues({ q: value }));

  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      listRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );

  const invoices = usePagedList({
    key: INVOICES_KEY,
    path: "/api/payments/invoices",
    params: {
      status: list.values.status === "all" ? undefined : list.values.status,
      q: list.values.q || undefined,
    },
    limit: 100,
    prepareExport: (rows) =>
      customerGate.allowed
        ? loadRecordLabels(
            "/api/customers",
            rows.map((row) => text(row.customerId, "")),
          )
        : Promise.resolve(),
  });
  // Customer names come from identity-service, which answers the counter roles only; other roles see the short id.
  const customers = useRecordLabels(
    "/api/customers",
    customerGate.allowed ? invoices.rows.map((row) => text(row.customerId, "")) : [],
    customerLabel,
  );

  const confirmCash = async (row: JsonRecord): Promise<void> => {
    const accepted = await confirm({
      title: "Confirm cash payment?",
      description: "The invoice will be marked as paid.",
      confirmLabel: "Confirm cash",
    });
    if (!accepted) return;
    await run({
      path: `/api/payments/${encodeURIComponent(idOf(row))}/confirm-counter`,
      invalidate: [INVOICES_KEY, FINANCE_SUMMARY_KEY],
      success: "Cash payment confirmed.",
    });
  };

  const [reconciling, setReconciling] = useState<JsonRecord>();

  const refund = async (row: JsonRecord): Promise<void> => {
    const request = await askRefund(row.amount);
    if (request === null) return;
    await run({
      path: `/api/payments/${encodeURIComponent(idOf(row))}/refund`,
      body: request,
      invalidate: [INVOICES_KEY, FINANCE_SUMMARY_KEY],
      success: "Payment refunded.",
    });
  };

  const columns: Array<DataColumn<JsonRecord>> = [
    {
      key: "paymentCode",
      label: translateText("Invoice"),
      render: (row) => text(row.paymentCode, "") || shortId(row.id),
      truncate: 24,
    },
    {
      key: "orderId",
      hideBelow: "lg",
      label: translateText("Order"),
      render: (row) => (row.orderId ? orderLabel(row.orderId) : "-"),
      text: (row) => (row.orderId ? orderLabel(row.orderId) : ""),
    },
    {
      key: "customerId",
      hideBelow: "xl",
      label: translateText("Customer"),
      render: (row) => (row.customerId ? (customers.get(text(row.customerId, "")) ?? shortId(row.customerId)) : "-"),
      text: (row) => (row.customerId ? (customers.get(text(row.customerId, "")) ?? shortId(row.customerId)) : ""),
      truncate: 24,
    },
    {
      key: "amount",
      label: translateText("Amount"),
      align: "right",
      render: (row) => formatAmount(row.amount, text(row.currency, "VND"), moneyLocale()),
      text: (row) => text(row.amount, ""),
    },
    {
      key: "status",
      label: translateText("Status"),
      render: (row) => (
        <StatusBadge tone={INVOICE_TONE[text(row.status, "")] ?? "neutral"}>
          {translateText(text(row.status))}
        </StatusBadge>
      ),
      text: (row) => translateText(text(row.status, "")),
    },
    {
      key: "createdAt",
      hideBelow: "lg",
      label: translateText("Created"),
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: "actions",
      label: translateText("Actions"),
      pinned: "right",
      render: (row) => (
        <RowActions label={text(row.paymentCode, "") || shortId(row.id)}>
          <Button size="sm" variant="ghost" onClick={() => setReconciling(row)}>
            {translateText("Reconciliation")}
          </Button>
          {confirmGate.allowed && text(row.status, "") === "Pending" ? (
            <Button size="sm" onClick={() => void confirmCash(row)}>
              {translateText("Confirm cash")}
            </Button>
          ) : null}
          {refundGate.allowed && !isCounterInvoice(row) && text(row.status, "") === "Paid" ? (
            <Button size="sm" variant="danger-ghost" onClick={() => void refund(row)}>
              {translateText("Refund")}
            </Button>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <div ref={listRef} className="grid gap-3">
      {invoices.error ? <Alert variant="danger">{translateText(invoices.error.message)}</Alert> : null}
      <DataTable
        toolbarStart={
          <Select
            aria-label={translateText("Status")}
            className="w-auto min-w-44"
            value={list.values.status}
            onChange={(event) => list.setValues({ status: event.target.value })}
          >
            <option value="all">{translateText("All statuses")}</option>
            {INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {translateText(status)}
              </option>
            ))}
          </Select>
        }
        toolbarExtra={<SavedViewsMenu pageKey="finance-invoices" defaults={LIST_DEFAULTS} />}
        storageKey="staff:finance:invoices"
        labels={dataTableLabels()}
        rows={invoices.rows}
        columns={columns}
        getKey={(row) => idOf(row)}
        loading={invoices.isLoading}
        empty={translateText("No records found")}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: translateText("Search by invoice number, order ID or customer ID"),
        }}
        paging={{ ...invoices.paging, pages: true }}
        exportCsv={{ filename: "invoices.csv" }}
      />
      {reconciling ? (
        <ReconciliationDrawer
          invoiceId={idOf(reconciling)}
          title={text(reconciling.paymentCode, "") || shortId(reconciling.id)}
          currency={text(reconciling.currency, "VND")}
          onClose={() => setReconciling(undefined)}
        />
      ) : null}
    </div>
  );
};
