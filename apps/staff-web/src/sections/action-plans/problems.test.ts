import { afterEach, describe, expect, it } from "vitest";

import { setLanguage } from "../../i18n.ts";
import { ApiProblemError } from "../../staff-api.ts";
import { planWriteProblem } from "./problems.ts";

describe("planWriteProblem", () => {
  afterEach(() => setLanguage("vi"));

  it("names the plan that already exists on a 409 plan_exists", () => {
    setLanguage("en");
    const problem = { status: 409, code: "plan_exists", planId: "plan-7" };
    const reason = new ApiProblemError("Plan exists", problem);
    expect(planWriteProblem(reason)).toEqual({
      message: "A plan for this item is already open.",
      existingPlanId: "plan-7",
    });
  });

  it("leaves the plan id out when the answer does not carry one", () => {
    setLanguage("en");
    const problem = { status: 409, code: "plan_exists" };
    const reason = new ApiProblemError("Plan exists", problem);
    expect(planWriteProblem(reason).existingPlanId).toBeUndefined();
  });

  it("explains an owner who is not an active employee at the site on a 422 owner_not_found", () => {
    setLanguage("en");
    const reason = new ApiProblemError("Owner", { status: 422, code: "owner_not_found" });
    expect(planWriteProblem(reason)).toEqual({
      message: "This owner is not an active employee at this site. Choose another owner.",
    });
  });

  it("shows the service's own message for any other failure", () => {
    setLanguage("en");
    expect(planWriteProblem(new Error("Due date is invalid"))).toEqual({ message: "Due date is invalid" });
  });

  it("shows a generic message for a failure that is not an error", () => {
    setLanguage("en");
    expect(planWriteProblem("boom")).toEqual({ message: "The request failed." });
  });

  it("gives the Vietnamese text in Vietnamese", () => {
    setLanguage("vi");
    const problem = { status: 409, code: "plan_exists", planId: "p" };
    const reason = new ApiProblemError("Plan exists", problem);
    expect(planWriteProblem(reason).message).toBe("Mục này đã có kế hoạch đang mở.");
  });
});
