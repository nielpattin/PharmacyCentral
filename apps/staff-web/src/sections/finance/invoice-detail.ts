import type { StatusTone } from "@pharmacy/ui";

import { text, type JsonRecord } from "../../staff-api.ts";

/** How the bank's side of one invoice stands against what the invoice expected (BR-PAY-007). */
export const RECONCILIATION_STATES: Readonly<Record<string, { label: string; tone: StatusTone }>> = {
  Open: { label: "Awaiting payment", tone: "neutral" },
  Matched: { label: "Matched", tone: "success" },
  AmountMismatch: { label: "Amount mismatch", tone: "danger" },
  PartiallyRefunded: { label: "Partly refunded", tone: "warning" },
  Refunded: { label: "Refunded", tone: "info" },
};

export const INVOICE_TONE: Readonly<Record<string, StatusTone | undefined>> = {
  Pending: "warning",
  Paid: "success",
  Failed: "danger",
  Refunded: "info",
  Cancelled: "neutral",
};

const METHOD_LABELS: Readonly<Record<string, string>> = {
  sepay_qr: "Bank transfer QR",
  cash: "Cash",
  cash_on_delivery: "Cash on delivery",
};

/** The payment method as a label to translate; an unknown method shows as it is stored. */
export const methodLabel = (method: unknown): string => {
  const raw = text(method, "");
  return raw === "" ? "" : (METHOD_LABELS[raw] ?? raw);
};

export const recordsOf = (value: unknown): JsonRecord[] =>
  Array.isArray(value)
    ? value.filter((item): item is JsonRecord => typeof item === "object" && item !== null && !Array.isArray(item))
    : [];

/** One thing that happened to the invoice. `label` is English text to translate; `amount` is absent when none applies. */
export type TimelineEvent = { at: string; label: string; amount?: unknown; note?: string; tone: StatusTone };

const stamp = (value: unknown): number => {
  const time = new Date(text(value, "")).getTime();
  return Number.isNaN(time) ? 0 : time;
};

/**
 * The invoice's own story, newest first: when it was made, each payment attempt, each amount the bank reported and each
 * refund with its reason. It is built from the invoice read, so it needs no read of its own and shows no raw webhook body.
 */
export const invoiceTimeline = (invoice: JsonRecord): TimelineEvent[] => {
  const events: TimelineEvent[] = [];
  if (invoice.createdAt) events.push({ at: text(invoice.createdAt), label: "Invoice created", tone: "neutral" });
  for (const attempt of recordsOf(invoice.attempts)) {
    const status = text(attempt.status, "");
    events.push({
      at: text(attempt.createdAt, ""),
      label: "Payment attempt",
      amount: attempt.amount,
      note: [methodLabel(attempt.method), status].filter(Boolean).join(" · "),
      tone: INVOICE_TONE[status] ?? "neutral",
    });
  }
  for (const transaction of recordsOf(invoice.transactions)) {
    events.push({
      at: text(transaction.receivedAt, ""),
      label: "Money received",
      amount: transaction.amount,
      note: text(transaction.providerTransactionId, ""),
      tone: "success",
    });
  }
  for (const refund of recordsOf(invoice.refunds)) {
    events.push({
      at: text(refund.createdAt, ""),
      label: "Refunded",
      amount: refund.amount,
      note: text(refund.reason, ""),
      tone: "info",
    });
  }
  // A stable sort keeps the order of equal times as built: the invoice is created before anything else.
  return events.sort((a, b) => stamp(b.at) - stamp(a.at));
};
