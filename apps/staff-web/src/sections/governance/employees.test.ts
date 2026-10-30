import { describe, expect, it } from "vitest";

import { employeeLabel, filterEmployees, isEmployeeRow, toEmployeeAccount } from "./employees.ts";

const withName: Record<string, unknown> = {
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  actorType: "employee",
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
      actorType: "employee",
      email: "an@pharmacycentral.vn",
      displayName: "Nguyễn An",
      isActive: true,
      roles: ["Pharmacist"],
      siteIds: ["site-1"],
    });
  });

  it("reads an account as active unless the service says it is deactivated", () => {
    expect(toEmployeeAccount({ ...withName, isActive: false }).isActive).toBe(false);
    expect(toEmployeeAccount({ ...withName, isActive: true }).isActive).toBe(true);
  });

  it("reads a list that is not a list as empty", () => {
    expect(toEmployeeAccount(withoutName)).toMatchObject({ roles: [], siteIds: [] });
  });
});

describe("isEmployeeRow", () => {
  it("keeps employee accounts and drops customers", () => {
    expect(isEmployeeRow(withName)).toBe(true);
    expect(isEmployeeRow({ ...withName, actorType: "customer" })).toBe(false);
    expect(isEmployeeRow(withoutName)).toBe(false);
  });
});

describe("employeeLabel", () => {
  it("falls back from the display name to the email to a short id", () => {
    expect(employeeLabel(toEmployeeAccount(withName))).toBe("Nguyễn An");
    expect(employeeLabel(toEmployeeAccount(withoutName))).toBe("warehouse@pharmacycentral.vn");
    expect(
      employeeLabel({
        id: "22222222-bbbb",
        actorType: "employee",
        email: "",
        displayName: "",
        isActive: true,
        roles: [],
        siteIds: [],
      }),
    ).toBe("22222222");
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
