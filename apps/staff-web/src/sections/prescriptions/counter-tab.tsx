import { useRef } from "react";
import { Alert, Button, RowActions, StatusCell } from "@pharmacy/ui";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { withActionColumn } from "../../lib/action-column.ts";
import { useConfirm } from "../../components/confirm.tsx";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { usePagedList } from "../../hooks/usePagedList.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { SubTabs } from "../../components/forms.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { translateText } from "../../i18n.ts";
import { useRefundRequest } from "../finance/refund-request.ts";
import { useCan } from "../../permissions/use-can.ts";
import { idOf, formatDateTime, text, type JsonRecord } from "../../staff-api.ts";
import {
  ALL_STATUSES,
  activeStatus,
  formatAmount,
  canConfirmCash,
  canRefund,
  INVOICE_STATUSES,
  isCounterInvoice,
  paymentTone,
  queryParam,
  shortId,
  statusParam,
} from "../sales/rules.ts";
import { moneyLocale } from "../sales/shared.tsx";

const COUNTER_DEFAULTS = { q: "", status: ALL_STATUSES } as const;

/**
 * Counter payments: the invoices raised at the counter, newest first. Online order invoices are left out, since the
 * orders screen owns them. Cash is confirmed and payments refunded here.
 */
export const CounterTab = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(COUNTER_DEFAULTS);
  // Cash and refunds are the Pharmacist's. Platform Admin reads the counter and acts on nothing here (shell Decision 14).
  const confirmGate = useCan("payment.confirmCash");
  const refundGate = useCan("payment.refund.counter");
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  useFocusSearchHotkey(rootRef);
  const status = activeStatus(values.status, INVOICE_STATUSES, ALL_STATUSES);
  const invoices = usePagedList({
    key: ["staff-counter-invoices"],
    path: "/api/payments/invoices",
    params: { status: statusParam(status), q: queryParam(values.q) },
    limit: 100,
  });
  const run = useStaffAction();
  const confirm = useConfirm();
  const askRefund = useRefundRequest("Customer request");
  const rows = invoices.rows.filter(isCounterInvoice);

  const confirmCash = async (invoiceId: string): Promise<void> => {
    const accepted = await confirm({
      title: "Confirm cash payment?",
      description: "Confirm only once the cash is in the drawer.",
      confirmLabel: "Confirm cash",
    });
    if (!accepted) return;
    await run({
      path: `/api/payments/${encodeURIComponent(invoiceId)}/confirm-counter`,
      invalidate: [["staff-counter-invoices"]],
      success: "Counter payment confirmed.",
    });
  };

  const refund = async (invoice: JsonRecord): Promise<void> => {
    const request = await askRefund(invoice.amount);
    if (request === null) return;
    await run({
      path: `/api/payments/${encodeURIComponent(idOf(invoice))}/refund`,
      body: request,
      invalidate: [["staff-counter-invoices"]],
      success: "Payment refunded.",
    });
  };

  const hasRowAction = (row: JsonRecord): boolean => {
    const status = text(row.status, "");
    return (confirmGate.allowed && canConfirmCash(status)) || (refundGate.allowed && canRefund(status));
  };

  const columns: Column[] = [
    {
      key: "paymentCode",
      label: "Invoice",
      truncate: true,
      render: (row) => text(row.paymentCode, shortId(row.id)),
    },
    {
      key: "prescriptionId",
      hideBelow: "lg",
      label: "Prescription",
      render: (row) => shortId(row.prescriptionId) || "-",
    },
    {
      key: "status",
      label: "Payment",
      render: (row) => (
        <StatusCell tone={paymentTone(text(row.status, ""))}>{translateText(text(row.status, "-"))}</StatusCell>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (row) => formatAmount(row.amount, row.currency, moneyLocale()),
    },
    { key: "createdAt", hideBelow: "md", label: "Created", render: (row) => formatDateTime(row.createdAt) },
    {
      key: "actions",
      label: "Actions",
      enableSorting: false,
      pinned: "right",
      render: (row) => {
        const invoiceId = text(row.id, "");
        const invoiceStatus = text(row.status, "");
        return (
          <RowActions label={translateText("Payment actions")}>
            {confirmGate.allowed && canConfirmCash(invoiceStatus) ? (
              <Button size="sm" onClick={() => void confirmCash(invoiceId)}>
                {translateText("Confirm cash")}
              </Button>
            ) : null}
            {refundGate.allowed && canRefund(invoiceStatus) ? (
              <Button variant="danger-ghost" size="sm" onClick={() => void refund(row)}>
                {translateText("Refund")}
              </Button>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <SubTabs
        tabs={[...INVOICE_STATUSES]}
        active={status}
        onChange={(next) => setValues({ status: next }, { history: "push" })}
      />
      {invoices.error ? <Alert variant="danger">{translateText(invoices.error.message)}</Alert> : null}
      <DataTable
        storageKey="staff:sales:counter-payments"
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search by invoice number") }}
        toolbarExtra={<SavedViewsMenu pageKey="counter-payments" defaults={COUNTER_DEFAULTS} />}
        loading={invoices.isLoading}
        rows={rows}
        columns={withActionColumn(columns, rows.some(hasRowAction))}
        // Online-order invoices are filtered out per page, so an empty page can still have more behind "Load more".
        empty={
          invoices.hasMore ? "No counter payments on this page. Load more to keep looking." : "No counter payments."
        }
        paging={invoices.pagingAs((all) => all.filter(isCounterInvoice))}
        exportCsv={{ filename: "counter-payments.csv" }}
      />
    </div>
  );
};
