import { useQuery } from "@tanstack/react-query";

import type { StatusTone } from "@pharmacy/ui";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { formatDateTime, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { formatAmount } from "../sales/rules.ts";
import { moneyLocale } from "../sales/shared.tsx";
import { Fact, FactList } from "../inventory/shared.tsx";

const STATES: Readonly<Record<string, { label: string; tone: StatusTone }>> = {
  Open: { label: "Awaiting payment", tone: "neutral" },
  Matched: { label: "Matched", tone: "success" },
  AmountMismatch: { label: "Amount mismatch", tone: "danger" },
  PartiallyRefunded: { label: "Partly refunded", tone: "warning" },
  Refunded: { label: "Refunded", tone: "info" },
};

/** What the payment provider reported for one invoice against what the invoice expected. */
export const ReconciliationDrawer = ({
  invoiceId,
  title,
  currency,
  onClose,
}: {
  invoiceId: string;
  title: string;
  currency: string;
  onClose: () => void;
}): React.JSX.Element => {
  const query = useQuery({
    queryKey: ["staff-reconciliation", invoiceId],
    queryFn: () => readOne<JsonRecord>(`/api/payments/${encodeURIComponent(invoiceId)}/reconciliation`),
  });
  const record = query.data;
  const state = STATES[text(record?.state, "")];
  const money = (value: unknown): string => formatAmount(value, currency, moneyLocale());
  return (
    <EntityDrawer
      open
      onClose={onClose}
      title={title}
      subtitle={translateText("Reconciliation")}
      status={state ? { label: translateText(state.label), tone: state.tone } : undefined}
      details={
        query.error ? (
          <p className="text-sm text-danger">{translateText(query.error.message)}</p>
        ) : (
          <FactList>
            <Fact label="Expected amount">{record ? money(record.expectedAmount) : "-"}</Fact>
            <Fact label="Received amount">{record ? money(record.receivedAmount) : "-"}</Fact>
            <Fact label="Updated">{record?.updatedAt ? formatDateTime(record.updatedAt) : "-"}</Fact>
          </FactList>
        )
      }
    />
  );
};
