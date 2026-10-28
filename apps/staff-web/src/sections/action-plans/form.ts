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
 * The problems with the form, empty when it may be sent. A due date already in the past is accepted when `original`
 * keeps it, so an edit of an overdue plan's title does not ask for a new date.
 */
export const validatePlanForm = (
  values: PlanFormValues,
  today: string,
  original?: Pick<ActionPlan, "dueDate">,
): PlanFormIssue[] => {
  const issues: PlanFormIssue[] = [];
  const titleLength = values.title.trim().length;
  if (titleLength === 0 || titleLength > TITLE_MAX_LENGTH) issues.push("title_length");
  if (values.detail.trim().length > DETAIL_MAX_LENGTH) issues.push("detail_length");
  if (values.ownerId === "") issues.push("owner_required");
  if (!isIsoDate(values.dueDate)) issues.push("due_required");
  else if (values.dueDate < today && values.dueDate !== original?.dueDate) issues.push("due_past");
  return issues;
};

/** The starting values of a create form: the draft's text, no owner yet, and the default due date. */
export const createFormValues = (draft: ActionPlanDraft, today: string): PlanFormValues => ({
  title: draft.title,
  detail: draft.detail ?? "",
  ownerId: "",
  dueDate: defaultDueDate(today),
});

export const planFormValues = (plan: ActionPlan): PlanFormValues => ({
  title: plan.title,
  detail: plan.detail ?? "",
  ownerId: plan.ownerId,
  dueDate: plan.dueDate,
});

export const samePlanForm = (left: PlanFormValues, right: PlanFormValues): boolean =>
  left.title === right.title &&
  left.detail === right.detail &&
  left.ownerId === right.ownerId &&
  left.dueDate === right.dueDate;

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

/**
 * The PATCH body: only the fields that differ from the plan. An empty detail is sent as `null`, which clears it. An
 * unchanged form gives an empty object, so nothing is sent.
 */
export const planPatchBody = (plan: ActionPlan, values: PlanFormValues): JsonRecord => {
  const patch: JsonRecord = {};
  const title = values.title.trim();
  const detail = values.detail.trim() || null;
  if (title !== plan.title) patch.title = title;
  if (detail !== (plan.detail ?? null)) patch.detail = detail;
  if (values.ownerId !== plan.ownerId) patch.ownerId = values.ownerId;
  if (values.dueDate !== plan.dueDate) patch.dueDate = values.dueDate;
  return patch;
};
