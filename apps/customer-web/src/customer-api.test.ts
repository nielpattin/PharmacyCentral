import { describe, expect, it, vi } from "vitest";

import { forShopper } from "./customer-api.ts";

describe("forShopper", () => {
  it("loads a shopper's own rows", async () => {
    const load = vi.fn(async () => [{ id: "order-1" }]);
    await expect(forShopper({ actorType: "customer" }, load)).resolves.toEqual([{ id: "order-1" }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never asks the sales service for a staff session, which would answer every shopper's rows", async () => {
    const load = vi.fn(async () => [{ id: "someone-elses-order" }]);
    await expect(forShopper({ actorType: "employee" }, load)).resolves.toEqual([]);
    await expect(forShopper({ actorType: "system" }, load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("answers an empty list while the account is still unknown", async () => {
    const load = vi.fn(async () => [{ id: "order-1" }]);
    await expect(forShopper(undefined, load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
