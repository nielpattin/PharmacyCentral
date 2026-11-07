import { useQuery } from "@tanstack/react-query";
import { Alert, StatTile } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { useCan } from "../permissions/use-can.ts";
import { formatQuantity, readOne, text, type JsonRecord } from "../staff-api.ts";
import { FINANCE_SUMMARY_KEY } from "./finance/query-keys.ts";
import { InvoicesTab } from "./finance/invoices-tab.tsx";

/** Money taken, given back and kept, from `/api/finance/summary`. Only a Pharmacy Manager reads it. */
const PaymentTotals = (): React.JSX.Element => {
  const summaryQuery = useQuery({
    queryKey: FINANCE_SUMMARY_KEY,
    queryFn: () => readOne<JsonRecord>("/api/finance/summary"),
  });
  const summary = summaryQuery.data;
  const currency = text(summary?.currency, "VND");
  return (
    <div className="grid gap-2.5">
      {summaryQuery.error ? <Alert variant="danger">{translateText(summaryQuery.error.message)}</Alert> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
        {(
          [
            ["Paid", "paid"],
            ["Refunded", "refunded"],
            ["Net", "net"],
          ] as const
        ).map(([label, field]) => (
          <StatTile
            key={label}
            label={translateText(label)}
            value={`${formatQuantity(summary?.[field] ?? 0)} ${currency}`}
          />
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
