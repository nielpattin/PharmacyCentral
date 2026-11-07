import { useQuery } from "@tanstack/react-query";
import { Alert, Button, StatTile } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { useCan } from "../permissions/use-can.ts";
import { formatDateTime, readOne, text, type JsonRecord } from "../staff-api.ts";
import { FINANCE_SUMMARY_KEY } from "./finance/query-keys.ts";
import { formatAmount } from "./sales/rules.ts";
import { moneyLocale } from "./sales/shared.tsx";
import { InvoicesTab } from "./finance/invoices-tab.tsx";

/** Money taken, given back and kept, from `/api/finance/summary`. Only a Pharmacy Manager reads it. */
const PaymentTotals = (): React.JSX.Element => {
  const summaryQuery = useQuery({
    queryKey: FINANCE_SUMMARY_KEY,
    queryFn: () => readOne<JsonRecord>("/api/finance/summary"),
  });
  const summary = summaryQuery.data;
  const currency = text(summary?.currency, "VND");
  // A tile shows a figure only when the read answered: a placeholder while it loads and a dash when it failed, never 0.
  const figure = (field: string): string =>
    summary ? formatAmount(summary[field] ?? 0, currency, moneyLocale()) : summaryQuery.isPending ? "…" : "–";
  return (
    <div className="grid gap-2.5">
      {summaryQuery.error ? <Alert variant="danger">{translateText(summaryQuery.error.message)}</Alert> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
        {summaryQuery.dataUpdatedAt > 0 ? (
          <span>
            {translateText("Updated at")}: {formatDateTime(new Date(summaryQuery.dataUpdatedAt).toISOString())}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={summaryQuery.isFetching}
          onClick={() => void summaryQuery.refetch()}
        >
          {translateText("Refresh")}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2.5">
        {(
          [
            ["Paid", "paid"],
            ["Refunded", "refunded"],
            ["Net", "net"],
          ] as const
        ).map(([label, field]) => (
          <StatTile key={label} label={translateText(label)} value={figure(field)} />
        ))}
      </div>
    </div>
  );
};

/** Payment invoices, with the payment totals above them for a Pharmacy Manager. */
export const FinanceSection = (): React.JSX.Element => {
  const totalsGate = useCan("finance.summary.view");
  return (
    <div className="grid gap-4">
      {totalsGate.allowed ? <PaymentTotals /> : null}
      <InvoicesTab />
    </div>
  );
};
