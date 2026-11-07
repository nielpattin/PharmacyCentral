import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@pharmacy/ui";
import type { ReactNode } from "react";

import { EntityDrawer } from "../../components/entity-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { formatDateTime, formatQuantity, numberValue, readOne, text, type JsonRecord } from "../../staff-api.ts";
import { Fact, FactList } from "../inventory/shared.tsx";
import { orderLabel } from "../procurement/labels.ts";
import { formatAmount } from "../sales/rules.ts";
import { moneyLocale } from "../sales/shared.tsx";
import {
  INVOICE_TONE,
  RECONCILIATION_STATES,
  invoiceTimeline,
  methodLabel,
  recordsOf,
  type TimelineEvent,
} from "./invoice-detail.ts";

const Section = ({ title, children }: { title: string; children: ReactNode }): React.JSX.Element => (
  <section className="grid gap-2">
    <h3 className="text-sm font-semibold text-ink">{translateText(title)}</h3>
    {children}
  </section>
);

const Empty = ({ children }: { children: string }): React.JSX.Element => (
  <p className="text-sm text-muted">{translateText(children)}</p>
);

const Cell = ({ children, right }: { children: ReactNode; right?: boolean }): React.JSX.Element => (
  <td className={`py-1.5 pr-3 align-top text-sm text-ink ${right ? "text-right tabular-nums" : ""}`}>{children}</td>
);

const Head = ({ children, right }: { children: string; right?: boolean }): React.JSX.Element => (
  <th className={`pb-1 pr-3 text-xs font-medium text-muted ${right ? "text-right" : "text-left"}`}>
    {translateText(children)}
  </th>
);

/**
 * One invoice in a side panel: what it is for, what was paid and what the bank reported against it. It reads
 * `GET /api/payments/{id}`, which already carries the lines, attempts, bank transactions, refunds and reconciliation.
 * Raw webhook bodies and signatures are not part of that read and are never shown.
 */
export const InvoiceDrawer = ({
  invoiceId,
  title,
  onClose,
}: {
  invoiceId: string;
  title: string;
  onClose: () => void;
}): React.JSX.Element => {
  const query = useQuery({
    queryKey: ["staff-invoice", invoiceId],
    queryFn: () => readOne<JsonRecord>(`/api/payments/${encodeURIComponent(invoiceId)}`),
  });
  const invoice = query.data;
  const currency = text(invoice?.currency, "VND");
  const money = (value: unknown): string => formatAmount(value, currency, moneyLocale());
  const status = text(invoice?.status, "");
  const lines = recordsOf(invoice?.lines);
  const transactions = recordsOf(invoice?.transactions);
  const refunds = recordsOf(invoice?.refunds);
  const reconciliation =
    invoice && typeof invoice.reconciliation === "object" && invoice.reconciliation !== null
      ? (invoice.reconciliation as JsonRecord)
      : undefined;
  const reconciliationState = RECONCILIATION_STATES[text(reconciliation?.state, "Open")];
  const instruction =
    invoice && typeof invoice.paymentInstruction === "object" && invoice.paymentInstruction !== null
      ? (invoice.paymentInstruction as JsonRecord)
      : undefined;
  const method = methodLabel(text(instruction?.method, "") || text(recordsOf(invoice?.attempts)[0]?.method, ""));
  const mismatch = text(reconciliation?.state, "") === "AmountMismatch";

  const details = query.error ? (
    <p className="text-sm text-danger">{translateText(query.error.message)}</p>
  ) : !invoice ? (
    <p className="text-sm text-muted">{translateText("Loading…")}</p>
  ) : (
    <>
      <Section title="Payment">
        <FactList>
          <Fact label="Invoice">{text(invoice.paymentCode, "-")}</Fact>
          <Fact label="Payment method">{method ? translateText(method) : "-"}</Fact>
          <Fact label="Amount">{money(invoice.amount)}</Fact>
          <Fact label="Order">{invoice.orderId ? orderLabel(invoice.orderId) : "-"}</Fact>
          <Fact label="Created">{formatDateTime(invoice.createdAt)}</Fact>
          {status === "Pending" && instruction?.transferContent ? (
            <Fact label="Transfer content">{text(instruction.transferContent)}</Fact>
          ) : null}
        </FactList>
      </Section>

      <Section title="Invoice lines">
        {lines.length === 0 ? (
          <Empty>No lines</Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Head>Product</Head>
                <Head right>Quantity</Head>
                <Head right>Unit price</Head>
                <Head right>Amount</Head>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={text(line.id, String(index))} className="border-t border-line">
                  <Cell>{text(line.description, "-")}</Cell>
                  <Cell right>{formatQuantity(line.quantity)}</Cell>
                  <Cell right>{money(line.unitPrice)}</Cell>
                  <Cell right>{money(numberValue(line.quantity) * numberValue(line.unitPrice))}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Reconciliation">
        <div className="flex flex-wrap items-center gap-2">
          {reconciliationState ? (
            <StatusBadge tone={reconciliationState.tone}>{translateText(reconciliationState.label)}</StatusBadge>
          ) : null}
        </div>
        <FactList>
          <Fact label="Expected amount">{money(reconciliation?.expectedAmount ?? invoice.amount)}</Fact>
          <Fact label="Received amount">
            <span className={mismatch ? "text-danger" : undefined}>{money(reconciliation?.receivedAmount ?? 0)}</span>
          </Fact>
          <Fact label="Updated">{formatDateTime(reconciliation?.updatedAt ?? invoice.updatedAt)}</Fact>
        </FactList>
      </Section>

      <Section title="Bank transactions">
        {transactions.length === 0 ? (
          <Empty>No money received yet.</Empty>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Head>Reference</Head>
                <Head right>Amount</Head>
                <Head>Time</Head>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction, index) => (
                <tr key={text(transaction.id, String(index))} className="border-t border-line">
                  <Cell>{text(transaction.providerTransactionId, "-")}</Cell>
                  <Cell right>{money(transaction.amount)}</Cell>
                  <Cell>{formatDateTime(transaction.receivedAt)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Refunds">
        {refunds.length === 0 ? (
          <Empty>No refunds.</Empty>
        ) : (
          <ul className="grid gap-2">
            {refunds.map((refund, index) => (
              <li key={text(refund.id, String(index))} className="grid gap-0.5 text-sm">
                <span className="text-ink">
                  {money(refund.amount)} · {formatDateTime(refund.createdAt)}
                </span>
                <span className="text-muted">{text(refund.reason, "-")}</span>
                {refund.createdBy ? (
                  <span className="text-xs text-muted">
                    {translateText("Actor")}: {text(refund.createdBy).slice(0, 8).toUpperCase()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );

  const events = invoice ? invoiceTimeline(invoice) : [];
  const history = (
    <Section title="History">
      {events.length === 0 ? (
        <Empty>No history yet.</Empty>
      ) : (
        <ol className="grid gap-3">
          {events.map((event: TimelineEvent, index) => (
            <li key={`${event.at}-${event.label}-${index}`} className="grid gap-0.5 border-l-2 border-line pl-3">
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <StatusBadge tone={event.tone}>{translateText(event.label)}</StatusBadge>
                {event.amount === undefined ? null : money(event.amount)}
              </span>
              {event.note ? <span className="text-sm text-muted">{event.note}</span> : null}
              <span className="text-xs text-muted">{formatDateTime(event.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );

  return (
    <EntityDrawer
      open
      onClose={onClose}
      title={title}
      subtitle={translateText("Invoice")}
      status={status ? { label: translateText(status), tone: INVOICE_TONE[status] ?? "neutral" } : undefined}
      details={details}
      history={history}
      width="xl"
    />
  );
};
