import { describe, expect, it } from "vitest";

import { confirmPayment, refundPayment, type PaymentInvoice } from "./payment.ts";

const invoice = (): PaymentInvoice => ({
  id: "invoice-1",
  paymentCode: "PC-1",
  amount: 100_000,
  currency: "VND",
  status: "Pending",
});

describe("payment workflow", () => {
  it("confirms matching provider transactions idempotently", () => {
    const seen = new Set<string>();
    const paid = confirmPayment(invoice(), { provider: "sepay", providerTransactionId: "tx-1", amount: 100_000 }, seen);
    expect(
      confirmPayment(paid, { provider: "sepay", providerTransactionId: "tx-1", amount: 100_000 }, seen).status,
    ).toBe("Paid");
    expect(() =>
      confirmPayment(invoice(), { provider: "sepay", providerTransactionId: "tx-2", amount: 1 }, seen),
    ).toThrow();
  });

  it("refunds only paid invoices", () => {
    expect(refundPayment({ ...invoice(), status: "Paid" }).status).toBe("Refunded");
    expect(() => refundPayment(invoice())).toThrow();
  });
});
