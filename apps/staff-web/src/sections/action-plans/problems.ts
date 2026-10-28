import { translateText } from "../../i18n.ts";
import { ApiProblemError } from "../../staff-api.ts";

export type PlanWriteProblem = {
  /** Staff-facing text, already translated. */
  message: string;
  /** Set on `plan_exists`: the id of the live plan that blocks the write. */
  existingPlanId?: string | undefined;
};

/** The `planId` a `plan_exists` problem carries, read without trusting its shape. */
const existingPlanIdOf = (problem: unknown): string | undefined => {
  if (typeof problem !== "object" || problem === null || !("planId" in problem)) return undefined;
  return typeof problem.planId === "string" ? problem.planId : undefined;
};

/**
 * The staff-facing text of a failed plan write. `plan_exists` (409) and `owner_not_found` (422) get their own wording;
 * any other answer shows the service's own message.
 */
export const planWriteProblem = (reason: unknown): PlanWriteProblem => {
  if (reason instanceof ApiProblemError) {
    if (reason.problem.code === "plan_exists") {
      return {
        message: translateText("A plan for this item is already open."),
        existingPlanId: existingPlanIdOf(reason.problem),
      };
    }
    if (reason.problem.code === "owner_not_found") {
      return {
        message: translateText("This owner is not an active employee at this site. Choose another owner."),
      };
    }
  }
  return {
    message: reason instanceof Error ? translateText(reason.message) : translateText("The request failed."),
  };
};
