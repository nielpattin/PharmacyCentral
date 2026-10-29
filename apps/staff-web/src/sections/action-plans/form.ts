import type { JsonRecord } from "../../staff-api.ts";
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
