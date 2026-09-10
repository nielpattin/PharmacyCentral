export type PaymentStatus = "Pending" | "Paid" | "Failed" | "Refunded" | "Cancelled";

export type PaymentInvoice = {
  id: string;
  paymentCode: string;
  amount: number;
  currency: "VND";
  status: PaymentStatus;
};

export const confirmPayment = (
  invoice: PaymentInvoice,
  input: { provider: string; providerTransactionId: string; amount: number },
  seenTransactions: Set<string>,
): PaymentInvoice => {
  if (seenTransactions.has(`${input.provider}:${input.providerTransactionId}`)) {
    return invoice;
  }
  if (invoice.status !== "Pending") throw new Error("Payment is not pending");
  if (input.amount !== invoice.amount) throw new Error("Payment amount does not match invoice");
  seenTransactions.add(`${input.provider}:${input.providerTransactionId}`);
  return { ...invoice, status: "Paid" };
};

export const refundPayment = (invoice: PaymentInvoice): PaymentInvoice => {
  if (invoice.status !== "Paid") throw new Error("Only paid invoices can be refunded");
  return { ...invoice, status: "Refunded" };
};
