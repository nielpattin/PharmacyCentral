import { describe, expect, it } from "vitest";

import { EMPLOYEE_ACCOUNT_REQUIRED, NO_ROLE_ASSIGNED, staffAccessRefusal } from "./auth.ts";

describe("staff sign-in refusal", () => {
  it("refuses a customer account, which keeps no staff session", () => {
    expect(staffAccessRefusal({ actorType: "customer", roles: [] })).toBe(EMPLOYEE_ACCOUNT_REQUIRED);
  });

  it("refuses an employee with no role", () => {
    expect(staffAccessRefusal({ actorType: "employee", roles: [] })).toBe(NO_ROLE_ASSIGNED);
  });

  it("admits an employee with a role", () => {
    expect(staffAccessRefusal({ actorType: "employee", roles: ["Pharmacist"] })).toBeUndefined();
  });
});
