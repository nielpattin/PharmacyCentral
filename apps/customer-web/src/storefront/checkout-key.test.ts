import { describe, expect, it } from "vitest";

import { createCheckoutKeys } from "./checkout-key.ts";

describe("createCheckoutKeys", () => {
  const sequence = () => {
    let next = 0;
    return () => `key-${++next}`;
  };

  it("reuses the key when the same submission is sent again", () => {
    const keys = createCheckoutKeys(sequence());

    expect(keys.keyFor("order-a")).toBe("key-1");
    expect(keys.keyFor("order-a")).toBe("key-1");
  });

  it("gives a changed submission a new key", () => {
    const keys = createCheckoutKeys(sequence());

    expect(keys.keyFor("order-a")).toBe("key-1");
    expect(keys.keyFor("order-b")).toBe("key-2");
  });

  it("gives the next submission a new key once the order was created, even for the same signature", () => {
    const keys = createCheckoutKeys(sequence());
    keys.keyFor("order-a");

    keys.settle();

    expect(keys.keyFor("order-a")).toBe("key-2");
  });

  it("uses a random UUID by default", () => {
    const keys = createCheckoutKeys();

    expect(keys.keyFor("order-a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
