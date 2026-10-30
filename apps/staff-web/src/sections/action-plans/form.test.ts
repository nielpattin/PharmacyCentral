import { describe, expect, it } from "vitest";

import type { ActionPlanDraft } from "./drafts.ts";
import {
  createFormValues,
  createPlanBody,
  reassignBody,
  reassignIssues,
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

describe("samePlanForm", () => {
  it("compares every field", () => {
    expect(samePlanForm(valid, { ...valid })).toBe(true);
    expect(samePlanForm(valid, { ...valid, dueDate: "2026-11-01" })).toBe(false);
  });
});

describe("reassignment", () => {
  const plan = {
    id: "p1",
    sourceType: "expiry",
    sourceRef: "r1",
    title: "Clear LOT-1",
    detail: null,
    siteId: null,
    productId: null,
    ownerId: "owner-1",
    dueDate: "2026-01-01",
    status: "open",
    createdBy: "system",
    createdAt: "",
    updatedAt: "",
    completedAt: null,
  } as const;
  const values: PlanFormValues = { title: "Clear LOT-1", detail: "", ownerId: "owner-1", dueDate: "2026-01-01" };

  it("sends only the owner, due date and title that changed", () => {
    expect(reassignBody(plan, values)).toEqual({});
    expect(reassignBody(plan, { ...values, ownerId: "owner-2" })).toEqual({ ownerId: "owner-2" });
    expect(reassignBody(plan, { ...values, title: " New title ", dueDate: "2026-02-01" })).toEqual({
      title: "New title",
      dueDate: "2026-02-01",
    });
  });

  it("keeps an overdue due date valid until the manager picks a new one in the past", () => {
    expect(reassignIssues(values, plan, TODAY)).toEqual([]);
    expect(reassignIssues({ ...values, dueDate: "2025-12-31" }, plan, TODAY)).toEqual(["due_past"]);
  });
});
