import { describe, expect, it } from "vitest";

import { serviceCatalogSchema } from "../../contracts/system.ts";
import { ROUTE_TABLE } from "./route-table.ts";
import { buildServiceCatalog, calledByIndex } from "./service-catalog.ts";
import { SERVICE_MANIFEST } from "./service-manifest.ts";

describe("calledByIndex", () => {
  it("lists, for each service, the services whose dependsOn names it, sorted", () => {
    const callers = calledByIndex([
      { name: "sales-service", dependsOn: ["catalog-service"] },
      { name: "payment-service", dependsOn: ["catalog-service", "sales-service"] },
      { name: "catalog-service", dependsOn: [] },
    ]);
    expect(callers.get("catalog-service")).toEqual(["payment-service", "sales-service"]);
    expect(callers.get("sales-service")).toEqual(["payment-service"]);
    expect(callers.get("payment-service")).toBeUndefined();
  });
});

describe("buildServiceCatalog", () => {
  const catalog = buildServiceCatalog(SERVICE_MANIFEST, ROUTE_TABLE);

  it("produces the catalog contract", () => {
    expect(serviceCatalogSchema.parse(catalog)).toEqual(catalog);
  });

  it("derives calledBy for catalog-service from every other entry's dependsOn", () => {
    const catalogService = catalog.services.find((service) => service.name === "catalog-service");
    expect(catalogService?.calledBy).toEqual([
      "chatbot-service",
      "inventory-service",
      "operations-query-service",
      "payment-service",
      "sales-service",
      "search-service",
    ]);
    expect(catalogService?.dependsOn).toEqual([]);
  });

  it("takes the route prefixes of each service from the route table, method included", () => {
    const search = catalog.services.find((service) => service.name === "search-service");
    expect(search?.routePrefixes).toEqual(["GET /api/products"]);
    const system = ROUTE_TABLE.filter((row) => row.service === "ops-console-service").map((row) => row.path);
    expect(system).toEqual(["/api/system*"]);
  });
});
