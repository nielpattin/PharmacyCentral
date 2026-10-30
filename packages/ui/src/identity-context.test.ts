import { describe, expect, it } from "vitest";

import { apiServiceForPath } from "./identity-context.ts";

describe("apiServiceForPath", () => {
  it("routes a sales target write to sales-service and its report to operations-query-service", () => {
    expect(apiServiceForPath("/api/sales-targets")).toBe("sales-service");
    expect(apiServiceForPath("/api/dashboard/sales-targets?month=2026-10")).toBe("operations-query-service");
  });

  it("ignores the query string and answers nothing for a path outside the map", () => {
    expect(apiServiceForPath("/api/orders?limit=10")).toBe("sales-service");
    expect(apiServiceForPath("/api/unknown")).toBeUndefined();
    expect(apiServiceForPath("https://elsewhere.test/api/orders")).toBeUndefined();
  });
});
