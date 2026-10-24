import { describe, expect, it } from "vitest";

import { employeeLabel, filterEmployees, toEmployeeAccount } from "./employees.ts";

const withName: Record<string, unknown> = {
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  email: "an@pharmacycentral.vn",
  displayName: "Nguyễn An",
  roles: ["Pharmacist", 7],
  siteIds: ["site-1"],
};
const withoutName: Record<string, unknown> = {
  id: "22222222-bbbb-4bbb-8bbb-222222222222",
  email: "warehouse@pharmacycentral.vn",
  displayName: "",
  roles: "Warehouse Staff",
};

describe("toEmployeeAccount", () => {
  it("keeps only the string roles and site ids", () => {
    expect(toEmployeeAccount(withName)).toEqual({
      id: "11111111-aaaa-4aaa-8aaa-111111111111",
      email: "an@pharmacycentral.vn",
      displayName: "Nguyễn An",
      roles: ["Pharmacist"],
      siteIds: ["site-1"],
    });
  });

  it("reads a list that is not a list as empty", () => {
    expect(toEmployeeAccount(withoutName)).toMatchObject({ roles: [], siteIds: [] });
  });
});

describe("employeeLabel", () => {
  it("falls back from the display name to the email to a short id", () => {
    expect(employeeLabel(toEmployeeAccount(withName))).toBe("Nguyễn An");
    expect(employeeLabel(toEmployeeAccount(withoutName))).toBe("warehouse@pharmacycentral.vn");
    expect(employeeLabel({ id: "22222222-bbbb", email: "", displayName: "", roles: [], siteIds: [] })).toBe("22222222");
  });
});

describe("filterEmployees", () => {
  const rows = [withName, withoutName];

  it("keeps every row for a blank query", () => {
    expect(filterEmployees(rows, "   ")).toBe(rows);
  });

  it("matches the display name and the email without case", () => {
    expect(filterEmployees(rows, "NGUYỄN")).toEqual([withName]);
    expect(filterEmployees(rows, "Warehouse@")).toEqual([withoutName]);
  });

  it("returns nothing when no field matches", () => {
    expect(filterEmployees(rows, "zzz")).toEqual([]);
  });
});
