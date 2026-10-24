import { describe, expect, it } from "vitest";

import type { SystemRouteRow } from "./catalog-api.ts";
import { filterRouteRows } from "./route-rows.ts";

const rows: SystemRouteRow[] = [
  { path: "/api/products", method: "GET", service: "search-service", access: { kind: "public" } },
  {
    path: "/api/quality*",
    service: "inventory-service",
    access: { kind: "roles", roles: ["Warehouse Staff"] },
    note: "Quality checks",
  },
  { path: "/api/system*", service: "ops-console-service", access: { kind: "platform-admin" } },
];

describe("filterRouteRows", () => {
  it("keeps every row for an empty or blank query", () => {
    expect(filterRouteRows(rows, "")).toEqual(rows);
    expect(filterRouteRows(rows, "   ")).toEqual(rows);
  });

  it("matches the path, the method and the service, ignoring case", () => {
    expect(filterRouteRows(rows, "SEARCH").map((row) => row.path)).toEqual(["/api/products"]);
    expect(filterRouteRows(rows, "get /api").map((row) => row.path)).toEqual(["/api/products"]);
  });

  it("matches a role name and the access kind", () => {
    expect(filterRouteRows(rows, "warehouse").map((row) => row.path)).toEqual(["/api/quality*"]);
    expect(filterRouteRows(rows, "platform-admin").map((row) => row.path)).toEqual(["/api/system*"]);
  });

  it("matches the note", () => {
    expect(filterRouteRows(rows, "quality checks").map((row) => row.path)).toEqual(["/api/quality*"]);
  });

  it("returns nothing when no row matches", () => {
    expect(filterRouteRows(rows, "payments")).toEqual([]);
  });
});
