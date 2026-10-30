import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@pharmacy/ui";
import { useState } from "react";

import { FormDrawer } from "../../components/form-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { writeJson } from "../../staff-api.ts";
import { ACTION_PLANS_KEY, actionPlanPath, type ActionPlan } from "./contract.ts";
import { planFormValues, reassignBody, reassignIssues, samePlanForm } from "./form.ts";
import { ownerOptionsFor } from "./owners.ts";
import { PlanFields } from "./plan-fields.tsx";
import { todayIsoDate } from "./plan-state.ts";
import { planWriteProblem } from "./problems.ts";
import { useStaffDirectory } from "./queries.ts";

/**
 * Lets a manager or Platform Admin give one plan to another employee of its site, move its due date and retitle it
 * (BR-PLAN-002). The status and the detail stay with the owner. Only the fields that changed are sent.
 */
export const ReassignPlanDrawer = ({
  open,
  plan,
  onClose,
}: {
  open: boolean;
  plan: ActionPlan;
  onClose: () => void;
}): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const directory = useStaffDirectory(true);
  const today = todayIsoDate();
  const [initial] = useState(() => planFormValues(plan));
  const [values, setValues] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const issues = reassignIssues(values, plan, today);

  const save = useMutation({
    mutationFn: () => writeJson<unknown>(actionPlanPath(plan.id), "PATCH", reassignBody(plan, values)),
    onSuccess: async () => {
      toast.success(translateText("Action plan saved."));
      await queryClient.invalidateQueries({ queryKey: ACTION_PLANS_KEY });
      onClose();
    },
    onError: (reason) => toast.error(planWriteProblem(reason).message),
  });

  const submit = (): void => {
    setAttempted(true);
    if (issues.length > 0) return;
    if (samePlanForm(values, initial)) {
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <FormDrawer
      open={open}
      title="Reassign action plan"
      subtitle={plan.title}
      formId="action-plan-reassign-form"
      submitLabel="Save changes"
      isDirty={!samePlanForm(values, initial)}
      onSubmit={submit}
      onClose={onClose}
    >
      <PlanFields
        values={values}
        onChange={setValues}
        issues={attempted ? issues : []}
        owners={ownerOptionsFor(directory.data ?? [], plan.siteId, plan.ownerId)}
        today={today}
        detail={false}
      />
    </FormDrawer>
  );
};
