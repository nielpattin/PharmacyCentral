import type { JsonRecord } from "../../staff-api.ts";
import type { ActionPlan } from "./contract.ts";
import { DETAIL_MAX_LENGTH, TITLE_MAX_LENGTH, type ActionPlanDraft } from "./drafts.ts";
import { defaultDueDate, isIsoDate } from "./plan-state.ts";

/** The editable fields of a plan, as the form holds them. `dueDate` is YYYY-MM-DD. */
export type PlanFormValues = {
  title: string;
  detail: string;
  ownerId: string;
  dueDate: string;
};

export type PlanFormIssue = "title_length" | "detail_length" | "owner_required" | "due_required" | "due_past";

/** The English text of each issue, translated where it is shown. */
export const PLAN_FORM_MESSAGES: Record<PlanFormIssue, string> = {
  title_length: "Enter a title of up to 300 characters.",
  detail_length: "Detail can be at most 2000 characters.",
  owner_required: "Choose an owner.",
  due_required: "Choose a due date.",
  due_past: "The due date cannot be in the past.",
};

/**
 * The problems with the form, empty when it may be sent.
 */
export const validatePlanForm = (values: PlanFormValues, today: string): PlanFormIssue[] => {
  const issues: PlanFormIssue[] = [];
  const titleLength = values.title.trim().length;
  if (titleLength === 0 || titleLength > TITLE_MAX_LENGTH) issues.push("title_length");
  if (values.detail.trim().length > DETAIL_MAX_LENGTH) issues.push("detail_length");
  if (values.ownerId === "") issues.push("owner_required");
  if (!isIsoDate(values.dueDate)) issues.push("due_required");
  else if (values.dueDate < today) issues.push("due_past");
  return issues;
};

/** The starting values of a create form: the draft's text, no owner yet, and the default due date. */
export const createFormValues = (draft: ActionPlanDraft, today: string): PlanFormValues => ({
  title: draft.title,
  detail: draft.detail ?? "",
  ownerId: "",
  dueDate: defaultDueDate(today),
});

export const samePlanForm = (left: PlanFormValues, right: PlanFormValues): boolean =>
  left.title === right.title &&
  left.detail === right.detail &&
  left.ownerId === right.ownerId &&
  left.dueDate === right.dueDate;

/** The values of an existing plan, which a reassignment starts from. */
export const planFormValues = (plan: ActionPlan): PlanFormValues => ({
  title: plan.title,
  detail: plan.detail ?? "",
  ownerId: plan.ownerId,
  dueDate: plan.dueDate,
});

/**
 * The problems with a reassignment. The detail is not part of it, and a due date the plan already has stays valid
 * even when it has passed: only a due date the manager picks must not lie in the past.
 */
export const reassignIssues = (values: PlanFormValues, plan: ActionPlan, today: string): PlanFormIssue[] =>
  validatePlanForm({ ...values, detail: "" }, today).filter(
    (issue) => !(issue === "due_past" && values.dueDate === plan.dueDate),
  );

/** The PATCH body of a reassignment: only the owner, due date and title the manager changed. */
export const reassignBody = (plan: ActionPlan, values: PlanFormValues): JsonRecord => ({
  ...(values.ownerId !== plan.ownerId ? { ownerId: values.ownerId } : {}),
  ...(values.dueDate !== plan.dueDate ? { dueDate: values.dueDate } : {}),
  ...(values.title.trim() !== plan.title ? { title: values.title.trim() } : {}),
});

/** The POST body. The source comes from the draft; the form supplies the text, owner and due date. */
export const createPlanBody = (draft: ActionPlanDraft, values: PlanFormValues): JsonRecord => ({
  sourceType: draft.sourceType,
  sourceRef: draft.sourceRef,
  title: values.title.trim(),
  detail: values.detail.trim() || undefined,
  siteId: draft.siteId,
  productId: draft.productId,
  ownerId: values.ownerId,
  dueDate: values.dueDate,
});
