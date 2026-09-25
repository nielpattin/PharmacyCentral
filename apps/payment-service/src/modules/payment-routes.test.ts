import { describe, expect, it } from "vitest";

import type { PaymentRepository } from "./payment-repository.ts";
import { applyWebhook } from "./payment-routes.ts";

interface AppliedTransaction {
  paymentCodes: string[];
  provider: string;
  providerTransactionId: string;
  amount: number;
}

const createStub = () => {
  const applied: AppliedTransaction[] = [];
  const repository = {
    applyProviderTransaction: (input: AppliedTransaction) => {
      applied.push(input);
      return Promise.resolve({ invoiceId: "invoice-id", duplicate: false, status: "Paid", reason: "accepted" });
    },
  } as unknown as PaymentRepository;
  return { repository, applied };
};

describe("SePay webhook payload handling", () => {
  it("matches a code whose hyphen the bank stripped", async () => {
    const { repository, applied } = createStub();
    const result = await applyWebhook(repository, {
      id: 92704,
      code: "",
      content: "PC957B5009D0374C73 thanh toan don hang",
      transferType: "in",
      transferAmount: 45000,
    });
    expect(result).toStrictEqual({ invoiceId: "invoice-id", duplicate: false, status: "Paid", reason: "accepted" });
    expect(applied.map((input) => input.paymentCodes)).toStrictEqual([["PC-957B5009D0374C73"]]);
  });

  it("ignores text appended after the code", async () => {
    const { repository, applied } = createStub();
    await applyWebhook(repository, {
      id: 92705,
      content: "PC-957B5009D0374C73ABC",
      transferType: "in",
      transferAmount: 45000,
    });
    expect(applied.map((input) => input.paymentCodes)).toStrictEqual([["PC-957B5009D0374C73"]]);
  });

  it("keeps SePay's truncated code ahead of the full memo", async () => {
    const { repository, applied } = createStub();
    await applyWebhook(repository, {
      id: 92706,
      code: "PC-957B5009",
      content: "PC-957B5009D0374C73 thanh toan",
      description: "PC-AE17E1B755A54208",
      transferType: "in",
      transferAmount: 45000,
    });
    expect(applied.map((input) => input.paymentCodes)).toStrictEqual([["PC-957B5009D0374C73", "PC-AE17E1B755A54208"]]);
  });

  it("passes the provider transaction through unchanged", async () => {
    const { repository, applied } = createStub();
    await applyWebhook(repository, {
      id: 92707,
      content: "PC-957B5009D0374C73",
      transferType: "in",
      transferAmount: 373000,
    });
    expect(applied).toStrictEqual([
      {
        paymentCodes: ["PC-957B5009D0374C73"],
        provider: "sepay",
        providerTransactionId: "92707",
        amount: 373000,
        metadata: { gateway: undefined, description: undefined, accountNumber: undefined },
      },
    ]);
  });

  it("rejects outbound transfers and payloads without a code, transaction id, or amount", async () => {
    const { repository, applied } = createStub();
    await expect(
      applyWebhook(repository, { id: 1, content: "PC-957B5009D0374C73", transferType: "out", transferAmount: 45000 }),
    ).resolves.toStrictEqual({ accepted: false, reason: "outbound_transfer" });
    await expect(
      applyWebhook(repository, { id: 2, content: "chuyen tien", transferType: "in", transferAmount: 45000 }),
    ).resolves.toBeUndefined();
    await expect(
      applyWebhook(repository, { content: "PC-957B5009D0374C73", transferType: "in", transferAmount: 45000 }),
    ).resolves.toBeUndefined();
    await expect(
      applyWebhook(repository, { id: 3, content: "PC-957B5009D0374C73", transferType: "in", transferAmount: 0 }),
    ).resolves.toBeUndefined();
    expect(applied).toStrictEqual([]);
  });
});
