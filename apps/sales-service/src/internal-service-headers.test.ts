import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { internalServiceHeaders } from "./internal-service-headers.ts";

describe("sales-service internalServiceHeaders", () => {
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_SERVICE_SECRET;
    } else {
      process.env.INTERNAL_SERVICE_SECRET = originalSecret;
    }
  });

  it("returns internal service secret header", () => {
    const headers = internalServiceHeaders();
    expect(headers).toEqual({
      "x-internal-service-secret": "test-internal-secret",
    });
  });

  it("includes x-actor-id header when actorId is provided", () => {
    const headers = internalServiceHeaders("usr-123");
    expect(headers).toEqual({
      "x-internal-service-secret": "test-internal-secret",
      "x-actor-id": "usr-123",
    });
  });

  it("omits x-actor-id when actorId is undefined or empty", () => {
    expect(internalServiceHeaders(undefined)).toEqual({
      "x-internal-service-secret": "test-internal-secret",
    });
    expect(internalServiceHeaders("")).toEqual({
      "x-internal-service-secret": "test-internal-secret",
    });
  });

  it("throws when INTERNAL_SERVICE_SECRET is unset instead of sending an empty secret", () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    expect(() => internalServiceHeaders("usr-456")).toThrow(/INTERNAL_SERVICE_SECRET/);
  });
});
