import { describe, expect, it } from "vitest";

import type { UpdateActionPlanRequest } from "../../contracts/action-plans.ts";

import {
  changedPlanFields,
  completedAtAfter,
  isAllowedDueDate,
  isCalendarDate,
  managesPlans,
  ownerCoversSite,
  planChanges,
  planPatchAccess,
  planReadScope,
  type PlanActor,
} from "./action-plan.ts";

const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const siteA = "00000000-0000-4000-8000-00000000000a";
const siteB = "00000000-0000-4000-8000-00000000000b";
const TODAY = "2026-10-28";
const NOW = new Date("2026-10-28T09:00:00Z");
const EARLIER = new Date("2026-10-01T09:00:00Z");

const employee = (id: string, roles: string[]): PlanActor => ({ id, roles, system: false });
const manager = employee(otherId, ["Pharmacy Manager"]);
const admin = employee(otherId, ["Platform Admin"]);
const pharmacist = employee(ownerId, ["Pharmacist"]);
const service: PlanActor = { id: undefined, roles: [], system: true };

describe("isCalendarDate", () => {
  it("accepts a real day written as YYYY-MM-DD", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });

  it("refuses a day the calendar does not have, or a text that is not that shape", () => {
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("26-10-28")).toBe(false);
    expect(isCalendarDate("2026-1-5")).toBe(false);
    expect(isCalendarDate("2026-10-28T00:00:00Z")).toBe(false);
  });
});

describe("isAllowedDueDate", () => {
  it("allows today and any later day", () => {
    expect(isAllowedDueDate(TODAY, TODAY)).toBe(true);
    expect(isAllowedDueDate("2026-11-01", TODAY)).toBe(true);
  });

  it("refuses a past day and a day the calendar does not have", () => {
    expect(isAllowedDueDate("2026-10-27", TODAY)).toBe(false);
    expect(isAllowedDueDate("2026-11-31", TODAY)).toBe(false);
  });
});

describe("completedAtAfter", () => {
  it("stamps the time when a plan enters done from an open status", () => {
    expect(completedAtAfter("open", "done", null, NOW)).toEqual(NOW);
    expect(completedAtAfter("in_progress", "done", null, NOW)).toEqual(NOW);
  });

  it("keeps the first stamp when a done plan is saved as done again", () => {
    expect(completedAtAfter("done", "done", EARLIER, NOW)).toEqual(EARLIER);
  });

  it("stamps now when a done plan without a stamp is saved as done", () => {
    expect(completedAtAfter("done", "done", null, NOW)).toEqual(NOW);
  });

  it("clears the stamp when a done plan is reopened", () => {
    expect(completedAtAfter("done", "open", EARLIER, NOW)).toBeNull();
    expect(completedAtAfter("done", "in_progress", EARLIER, NOW)).toBeNull();
  });

  it("leaves no stamp between the two open statuses", () => {
    expect(completedAtAfter("open", "in_progress", null, NOW)).toBeNull();
    expect(completedAtAfter("in_progress", "open", null, NOW)).toBeNull();
  });
});

describe("planChanges", () => {
  const open = { status: "open" as const, completedAt: null };

  it("writes only the fields the request names", () => {
    const patch: UpdateActionPlanRequest = { title: "Đặt bù thuốc A" };
    expect(planChanges(open, patch, NOW)).toEqual({ title: "Đặt bù thuốc A" });
  });

  it("sets the status and its completion time together when the status changes", () => {
    expect(planChanges(open, { status: "done" }, NOW)).toEqual({ status: "done", completedAt: NOW });
  });

  it("recomputes nothing for a status the plan already has", () => {
    expect(planChanges(open, { status: "open" }, NOW)).toEqual({ status: "open", completedAt: null });
  });

  it("clears a stamp when a done plan is reopened, and keeps it when it is saved as done again", () => {
    const done = { status: "done" as const, completedAt: EARLIER };
    expect(planChanges(done, { status: "open" }, NOW)).toEqual({ status: "open", completedAt: null });
    expect(planChanges(done, { status: "done" }, NOW)).toEqual({ status: "done", completedAt: EARLIER });
  });

  it("passes a cleared detail through as null and a new owner and due date as they are", () => {
    expect(planChanges(open, { detail: null, ownerId, dueDate: "2026-11-02" }, NOW)).toEqual({
      detail: null,
      ownerId,
      dueDate: "2026-11-02",
    });
  });
});

describe("changedPlanFields", () => {
  it("lists the fields the body names and no others", () => {
    expect(changedPlanFields({ status: "done", detail: null })).toEqual(["status", "detail"]);
    expect(changedPlanFields({ ownerId, dueDate: "2026-11-02" })).toEqual(["ownerId", "dueDate"]);
  });
});

describe("managesPlans", () => {
  it("is true for a Pharmacy Manager, a Platform Admin and a service", () => {
    expect(managesPlans(manager)).toBe(true);
    expect(managesPlans(admin)).toBe(true);
    expect(managesPlans(service)).toBe(true);
  });

  it("is false for every other employee", () => {
    expect(managesPlans(pharmacist)).toBe(false);
    expect(managesPlans(employee(ownerId, ["Warehouse Staff"]))).toBe(false);
  });
});

describe("planReadScope", () => {
  it("reads every plan for a Platform Admin and a service", () => {
    expect(planReadScope(admin)).toEqual({ kind: "all" });
    expect(planReadScope(service)).toEqual({ kind: "all" });
  });

  it("reads the plans of the sites for a Pharmacy Manager, even when she also holds another role", () => {
    expect(planReadScope(manager)).toEqual({ kind: "sites" });
    expect(planReadScope(employee(ownerId, ["Pharmacist", "Pharmacy Manager"]))).toEqual({ kind: "sites" });
  });

  it("reads only the plans the caller owns for every other employee", () => {
    expect(planReadScope(pharmacist)).toEqual({ kind: "owner", ownerId });
    expect(planReadScope(employee(ownerId, ["Warehouse Staff"]))).toEqual({ kind: "owner", ownerId });
  });

  it("refuses a personal list to an employee with no id", () => {
    expect(planReadScope(employee(undefined as unknown as string, ["Pharmacist"]))).toBeUndefined();
  });
});

describe("planPatchAccess", () => {
  const plan = { ownerId };

  it("lets a manager change any field, whoever owns the plan", () => {
    expect(planPatchAccess(manager, plan, ["ownerId", "dueDate", "title", "detail", "status"])).toBe("all");
    expect(planPatchAccess(admin, plan, ["status"])).toBe("all");
    expect(planPatchAccess(service, plan, ["title"])).toBe("all");
  });

  it("lets the owner move the status and nothing else", () => {
    expect(planPatchAccess(pharmacist, plan, ["status"])).toBe("status");
    expect(planPatchAccess(pharmacist, plan, ["dueDate"])).toBe("refuse");
    expect(planPatchAccess(pharmacist, plan, ["status", "title"])).toBe("refuse");
    expect(planPatchAccess(pharmacist, plan, ["ownerId"])).toBe("refuse");
  });

  it("refuses an employee who does not own the plan and is not a manager", () => {
    expect(planPatchAccess(employee(otherId, ["Warehouse Staff"]), plan, ["status"])).toBe("refuse");
    expect(planPatchAccess(employee(otherId, ["Pharmacist"]), plan, ["status"])).toBe("refuse");
  });

  it("refuses an employee with no id, who cannot be an owner", () => {
    expect(planPatchAccess(employee(undefined as unknown as string, ["Pharmacist"]), plan, ["status"])).toBe("refuse");
  });
});

describe("ownerCoversSite", () => {
  it("accepts a plan with no site", () => {
    expect(ownerCoversSite({ roles: ["Pharmacist"], siteIds: [] }, null)).toBe(true);
  });

  it("accepts an owner who holds the plan's site", () => {
    expect(ownerCoversSite({ roles: ["Pharmacist"], siteIds: [siteA, siteB] }, siteB)).toBe(true);
  });

  it("refuses an owner who does not hold the plan's site", () => {
    expect(ownerCoversSite({ roles: ["Pharmacist"], siteIds: [siteA] }, siteB)).toBe(false);
    expect(ownerCoversSite({ roles: ["Warehouse Staff"], siteIds: [] }, siteA)).toBe(false);
  });

  it("accepts a Platform Admin at any site", () => {
    expect(ownerCoversSite({ roles: ["Platform Admin"], siteIds: [] }, siteA)).toBe(true);
  });
});
