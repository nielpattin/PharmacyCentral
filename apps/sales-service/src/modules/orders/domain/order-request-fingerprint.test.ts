import { describe, expect, it } from "vitest";

import { orderRequestFingerprint } from "./order-request-fingerprint.ts";

describe("orderRequestFingerprint", () => {
  const request = {
    selectedStoreId: "store",
    lines: [{ productId: "p", productUnitId: "u", quantity: 2 }],
    delivery: { destination: { latitude: 10.5, longitude: 106.5 } },
  };

  it("is the same for the same request, whatever order its keys were sent in", () => {
    const reordered = {
      delivery: { destination: { longitude: 106.5, latitude: 10.5 } },
      lines: [{ quantity: 2, productUnitId: "u", productId: "p" }],
      selectedStoreId: "store",
    };

    expect(orderRequestFingerprint(reordered)).toBe(orderRequestFingerprint(request));
  });

  it("changes when any value of the request changes", () => {
    const changed = { ...request, lines: [{ productId: "p", productUnitId: "u", quantity: 3 }] };

    expect(orderRequestFingerprint(changed)).not.toBe(orderRequestFingerprint(request));
  });

  it("ignores a field that is absent or undefined, and keeps array order significant", () => {
    expect(orderRequestFingerprint({ a: 1, b: undefined })).toBe(orderRequestFingerprint({ a: 1 }));
    expect(orderRequestFingerprint({ items: [1, 2] })).not.toBe(orderRequestFingerprint({ items: [2, 1] }));
  });
});
