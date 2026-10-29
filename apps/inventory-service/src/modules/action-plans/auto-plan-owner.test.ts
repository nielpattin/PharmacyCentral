import { describe, expect, it } from "vitest";

import { pickPlanOwner } from "./auto-plan-owner.ts";
import type { ActiveEmployee } from "./identity-employee-client.ts";

const site = "00000000-0000-4000-8000-00000000000a";
const employee = (n: number, displayName: string, role: string): ActiveEmployee => ({
  id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
  displayName,
  roles: [role],
  siteIds: [site],
});

const lan = employee(1, "Phạm Thị Lan", "Pharmacist");
const chau = employee(2, "Lê Minh Châu", "Pharmacist");
const manager = employee(3, "An Quản lý", "Pharmacy Manager");
const warehouse = employee(4, "Kho", "Warehouse Staff");
const admin = employee(5, "Admin", "Platform Admin");

describe("pickPlanOwner", () => {
  it("takes the Pharmacist with the fewest open or in-progress plans", () => {
    const counts = new Map([
      [lan.id, 1],
      [chau.id, 3],
    ]);
    expect(pickPlanOwner([chau, lan, manager], counts)).toBe(lan);
  });

  it("counts a Pharmacist with no plans as zero", () => {
    expect(pickPlanOwner([lan, chau], new Map([[lan.id, 2]]))).toBe(chau);
  });

  it("breaks a tie by name, alphabetically", () => {
    expect(pickPlanOwner([lan, chau], new Map())).toBe(chau);
  });

  it("never prefers the Manager while a Pharmacist is at the site, however many plans the Pharmacist has", () => {
    expect(pickPlanOwner([manager, lan], new Map([[lan.id, 40]]))).toBe(lan);
  });

  it("falls back to the Pharmacy Manager when the site has no Pharmacist", () => {
    expect(pickPlanOwner([warehouse, manager, admin], new Map())).toBe(manager);
  });

  it("applies the same fewest-plans rule among several Managers", () => {
    const second = employee(6, "Bình Quản lý", "Pharmacy Manager");
    expect(pickPlanOwner([manager, second], new Map([[second.id, 1]]))).toBe(manager);
  });

  it("picks nobody when the site has neither, so no owner is guessed", () => {
    expect(pickPlanOwner([warehouse, admin], new Map())).toBeUndefined();
    expect(pickPlanOwner([], new Map())).toBeUndefined();
  });
});
