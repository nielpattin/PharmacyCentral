import { describe, expect, it } from "vitest";

import type { SystemServiceCatalog } from "./catalog-api.ts";
import { catalogView } from "./catalog-state.ts";

const catalog: SystemServiceCatalog = {
  services: [
    {
      name: "sales-service",
      description: "Carts, orders.",
      port: 3005,
      database: "sales_service",
      routePrefixes: ["/api/orders*"],
      dependsOn: ["catalog-service"],
      calledBy: [],
      events: { published: [], consumed: [] },
    },
  ],
};

describe("catalogView", () => {
  it("is loading until the catalog answers or fails", () => {
    expect(catalogView({ data: undefined, isError: false }, "sales-service")).toEqual({ status: "loading" });
  });

  it("is an error when the first load fails, without touching the rest of the sheet", () => {
    expect(catalogView({ data: undefined, isError: true }, "sales-service")).toEqual({ status: "error" });
  });

  it("is ready with the entry of the named service", () => {
    const view = catalogView({ data: catalog, isError: false }, "sales-service");
    expect(view).toEqual({ status: "ready", entry: catalog.services[0] });
  });

  it("reports a service the catalog does not list as missing", () => {
    expect(catalogView({ data: catalog, isError: false }, "payment-service")).toEqual({ status: "missing" });
  });

  it("keeps the loaded catalog when a later refetch fails", () => {
    expect(catalogView({ data: catalog, isError: true }, "sales-service")).toEqual({
      status: "ready",
      entry: catalog.services[0],
    });
  });
});
