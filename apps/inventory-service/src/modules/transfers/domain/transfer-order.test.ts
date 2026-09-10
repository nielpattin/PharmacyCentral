import { describe, expect, it } from "vitest";

import { transitionTransfer } from "./transfer-order.ts";

describe("transfer lifecycle", () => {
  it("requires approval, shipment, and receipt in order", () => {
    expect(transitionTransfer("PendingApproval", "approve")).toBe("Approved");
    expect(transitionTransfer("Approved", "ship")).toBe("InTransit");
    expect(transitionTransfer("InTransit", "receive")).toBe("Received");
    expect(() => transitionTransfer("PendingApproval", "receive")).toThrow();
  });
});
