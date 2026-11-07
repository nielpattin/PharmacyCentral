import { usePrompt } from "../../components/confirm.tsx";
import { translateText } from "../../i18n.ts";

export type RefundRequest = { reason: string; amount?: number };

/** Typed text as a refund amount: nothing typed, or the whole invoice, means no amount (the server pays back what is left). */
export const refundAmount = (typed: string, invoiceAmount: unknown): number | undefined => {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;
  const amount = Number(trimmed.replace(/,/g, "."));
  return amount === Number(invoiceAmount) ? undefined : amount;
};

/**
 * Asks how much to pay back (the whole invoice by default), then why. Resolves with null when either question is
 * cancelled. A typed amount the server cannot accept (not a number, more than what is left) is refused there and shown.
 */
export const REFUND_REASON_MAX = 500;

export const useRefundRequest = (
  defaultReason?: string,
): ((invoiceAmount: unknown) => Promise<RefundRequest | null>) => {
  const prompt = usePrompt();
  return async (invoiceAmount) => {
    const typed = await prompt({
      title: "Refund payment",
      label: "Refund amount",
      description: "Leave the full amount to pay back the whole invoice, or enter a smaller one for a partial refund.",
      required: true,
      defaultValue: String(Number(invoiceAmount)),
      confirmLabel: "Next",
    });
    if (typed === null) return null;
    const reason = await prompt({
      title: "Refund payment",
      label: "Refund reason",
      required: true,
      maxLength: REFUND_REASON_MAX,
      ...(defaultReason ? { defaultValue: translateText(defaultReason) } : {}),
      confirmLabel: "Refund",
    });
    if (reason === null) return null;
    const amount = refundAmount(typed, invoiceAmount);
    return amount === undefined ? { reason } : { reason, amount };
  };
};
