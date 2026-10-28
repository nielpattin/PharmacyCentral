import { describe, expect, it } from "vitest";

import type { ActionPlan } from "./contract.ts";
import type { ActionPlanDraft } from "./drafts.ts";
import {
  createFormValues,
  createPlanBody,
  planFormValues,
  planPatchBody,
  samePlanForm,
  validatePlanForm,
  type PlanFormValues,
} from "./form.ts";

const TODAY = "2026-10-28";

const valid: PlanFormValues = {
  title: "Bổ sung Gạc",
  detail: "",
  ownerId: "user-2",
  dueDate: "2026-10-30",
};

const plan: ActionPlan = {
  id: "plan-1",
  sourceType: "replenishment",
  sourceRef: "replenishment:site-1:prod-2",
  title: "Bổ sung Gạc",
  detail: "Đề xuất đặt 3 đơn vị.",
  siteId: "site-1",
  productId: "prod-2",
  ownerId: "user-2",
  dueDate: "2026-10-30",
  status: "open",
  createdBy: "manager-1",
  createdAt: "2026-10-27T08:00:00Z",
  updatedAt: "2026-10-27T08:00:00Z",
  completedAt: null,
};

const draft: ActionPlanDraft = {
  sourceType: "replenishment",
  sourceRef: "replenishment:site-1:prod-2",
  title: "Bổ sung Gạc",
  detail: "Đề xuất đặt 3 đơn vị.",
  siteId: "site-1",
  productId: "prod-2",
};

describe("validatePlanForm", () => {
  it("accepts a complete form with a due date in the future", () => {
    expect(validatePlanForm(valid, TODAY)).toEqual([]);
  });

  it("refuses an empty title and a title over 300 characters", () => {
    expect(validatePlanForm({ ...valid, title: "   " }, TODAY)).toEqual(["title_length"]);
    expect(validatePlanForm({ ...valid, title: "a".repeat(301) }, TODAY)).toEqual(["title_length"]);
  });

  it("refuses a detail over 2000 characters", () => {
    expect(validatePlanForm({ ...valid, detail: "a".repeat(2001) }, TODAY)).toEqual(["detail_length"]);
  });

  it("requires an owner", () => {
    expect(validatePlanForm({ ...valid, ownerId: "" }, TODAY)).toEqual(["owner_required"]);
  });

  it("requires a real due date", () => {
    expect(validatePlanForm({ ...valid, dueDate: "" }, TODAY)).toEqual(["due_required"]);
    expect(validatePlanForm({ ...valid, dueDate: "2026-02-30" }, TODAY)).toEqual(["due_required"]);
  });

  it("refuses a due date in the past for a new plan", () => {
    expect(validatePlanForm({ ...valid, dueDate: "2026-10-27" }, TODAY)).toEqual(["due_past"]);
  });

  it("accepts an overdue due date the plan already has, so a title edit is not blocked", () => {
    expect(validatePlanForm({ ...valid, dueDate: "2026-10-20" }, TODAY, { dueDate: "2026-10-20" })).toEqual([]);
  });

  it("refuses a new past due date even on an edit", () => {
    expect(validatePlanForm({ ...valid, dueDate: "2026-10-21" }, TODAY, { dueDate: "2026-10-20" })).toEqual([
      "due_past",
    ]);
  });
});

describe("createFormValues", () => {
  it("starts from the draft text, no owner, and the default due date", () => {
    expect(createFormValues(draft, TODAY)).toEqual({
      title: "Bổ sung Gạc",
      detail: "Đề xuất đặt 3 đơn vị.",
      ownerId: "",
      dueDate: "2026-11-04",
    });
  });

  it("starts with an empty detail when the draft has none", () => {
    expect(createFormValues({ ...draft, detail: undefined }, TODAY).detail).toBe("");
  });
});

describe("createPlanBody", () => {
  it("sends the contract fields with the source from the draft and the owner and due date from the form", () => {
    expect(createPlanBody(draft, valid)).toEqual({
      sourceType: "replenishment",
      sourceRef: "replenishment:site-1:prod-2",
      title: "Bổ sung Gạc",
      detail: undefined,
      siteId: "site-1",
      productId: "prod-2",
      ownerId: "user-2",
      dueDate: "2026-10-30",
    });
  });

  it("omits the site and product of a draft that has none, and trims the detail", () => {
    const body = createPlanBody(
      { sourceType: "price_warning", sourceRef: "price_warning:prod-9", title: "Thiếu giá bán: X" },
      { ...valid, detail: "  ghi chú  " },
    );
    expect(body.siteId).toBeUndefined();
    expect(body.productId).toBeUndefined();
    expect(body.detail).toBe("ghi chú");
  });
});

describe("planPatchBody", () => {
  it("sends nothing when the form matches the plan", () => {
    expect(planPatchBody(plan, planFormValues(plan))).toEqual({});
  });

  it("sends only the changed fields", () => {
    expect(planPatchBody(plan, { ...planFormValues(plan), ownerId: "user-5", dueDate: "2026-11-02" })).toEqual({
      ownerId: "user-5",
      dueDate: "2026-11-02",
    });
  });

  it("sends an emptied detail as null, which clears it", () => {
    expect(planPatchBody(plan, { ...planFormValues(plan), detail: "  " })).toEqual({ detail: null });
  });

  it("sends a plan's missing detail unchanged when the form leaves it blank", () => {
    expect(planPatchBody({ ...plan, detail: null }, { ...planFormValues(plan), detail: "" })).toEqual({});
  });
});

describe("samePlanForm", () => {
  it("compares every field", () => {
    expect(samePlanForm(valid, { ...valid })).toBe(true);
    expect(samePlanForm(valid, { ...valid, dueDate: "2026-11-01" })).toBe(false);
  });
});
