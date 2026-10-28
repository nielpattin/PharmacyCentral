import { describe, expect, it } from "vitest";

import type { ActionPlan } from "./contract.ts";
import { actionPlanListParams, visiblePlans } from "./list-query.ts";

const planOf = (id: string): ActionPlan => ({
  id,
  sourceType: "expiry",
  sourceRef: `expiry:site-1:${id}`,
  title: `Plan ${id}`,
  detail: null,
  siteId: "site-1",
  productId: null,
  ownerId: "user-1",
  dueDate: "2026-11-04",
  status: "open",
  createdBy: "manager-1",
  createdAt: "2026-10-28T08:00:00Z",
  updatedAt: "2026-10-28T08:00:00Z",
  completedAt: null,
});

describe("actionPlanListParams", () => {
  it("sends no filter for the defaults", () => {
    expect(actionPlanListParams({ q: "", status: "all", owner: "all" }, true)).toEqual({
      ownerId: undefined,
      status: undefined,
      q: undefined,
    });
  });

  it("sends the owner, the status and the trimmed search", () => {
    expect(actionPlanListParams({ q: "  gạc ", status: "in_progress", owner: "user-2" }, true)).toEqual({
      ownerId: "user-2",
      status: "in_progress",
      q: "gạc",
    });
  });

  it("drops the owner filter for a viewer who may not use it", () => {
    expect(actionPlanListParams({ q: "", status: "open", owner: "user-2" }, false).ownerId).toBeUndefined();
  });

  it("drops a status the contract does not know", () => {
    expect(actionPlanListParams({ q: "", status: "archived", owner: "all" }, true).status).toBeUndefined();
  });
});

describe("visiblePlans", () => {
  const plans = [planOf("a"), planOf("b")];

  it("shows every loaded plan when no plan is named", () => {
    expect(visiblePlans(plans, "")).toEqual(plans);
  });

  it("shows only the named plan", () => {
    expect(visiblePlans(plans, "b")).toEqual([planOf("b")]);
  });

  it("shows nothing when the named plan is not loaded", () => {
    expect(visiblePlans(plans, "z")).toEqual([]);
  });
});
