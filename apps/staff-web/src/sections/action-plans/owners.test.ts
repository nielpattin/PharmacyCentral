import { describe, expect, it } from "vitest";

import type { StaffEmployee } from "./contract.ts";
import { canReadStaffDirectory, ownerNameOf, ownerOptionsFor } from "./owners.ts";

const employees: StaffEmployee[] = [
  { id: "user-b", displayName: "Trần Thị B", roles: ["Pharmacist"], siteIds: ["site-1"] },
  { id: "user-a", displayName: "Nguyễn Văn A", roles: ["Warehouse Staff"], siteIds: ["site-2"] },
  { id: "admin", displayName: "Quản trị", roles: ["Platform Admin"], siteIds: [] },
];

describe("canReadStaffDirectory", () => {
  it("opens the directory to a Pharmacy Manager and Platform Admin only", () => {
    expect(canReadStaffDirectory({ roles: ["Pharmacy Manager"] })).toBe(true);
    expect(canReadStaffDirectory({ roles: ["Platform Admin"] })).toBe(true);
    expect(canReadStaffDirectory({ roles: ["Pharmacist"] })).toBe(false);
    expect(canReadStaffDirectory({ roles: ["Warehouse Staff"] })).toBe(false);
    expect(canReadStaffDirectory({})).toBe(false);
  });
});

describe("ownerOptionsFor", () => {
  it("offers the employees at the plan's site, and a Platform Admin, sorted by name", () => {
    expect(ownerOptionsFor(employees, "site-1")).toEqual([
      { value: "admin", label: "Quản trị" },
      { value: "user-b", label: "Trần Thị B" },
    ]);
  });

  it("offers every employee for a plan with no site", () => {
    expect(ownerOptionsFor(employees, null).map((option) => option.value)).toEqual(
      expect.arrayContaining(["user-a", "user-b", "admin"]),
    );
    expect(ownerOptionsFor(employees, undefined)).toHaveLength(3);
  });

  it("keeps the saved owner listed when the directory no longer holds them", () => {
    expect(ownerOptionsFor(employees, "site-1", "user-gone")).toContainEqual({
      value: "user-gone",
      label: "USER-GON",
    });
  });
});

describe("ownerNameOf", () => {
  it("names an owner from the directory", () => {
    expect(ownerNameOf("user-b", employees, { userId: "user-a", displayName: "Nguyễn Văn A" })).toBe("Trần Thị B");
  });

  it("names a non-manager's own plan from the session, since no directory is read", () => {
    expect(ownerNameOf("me", [], { userId: "me", displayName: "Lê Thị C" })).toBe("Lê Thị C");
  });

  it("falls back to the short id for an owner it cannot name", () => {
    expect(ownerNameOf("0123456789abcdef", [], { userId: "me", displayName: "Lê Thị C" })).toBe("01234567");
  });
});
