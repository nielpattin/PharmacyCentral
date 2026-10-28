import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@pharmacy/ui";
import { useState } from "react";

import { FormDrawer } from "../../components/form-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { writeJson, type JsonRecord } from "../../staff-api.ts";
import { ACTION_PLANS_KEY, actionPlanPath, type ActionPlan } from "./contract.ts";
import { planFormValues, planPatchBody, samePlanForm, validatePlanForm } from "./form.ts";
import { ownerOptionsFor } from "./owners.ts";
import { PlanFields } from "./plan-fields.tsx";
import { planWriteProblem } from "./problems.ts";
import { todayIsoDate } from "./plan-state.ts";
import { useStaffDirectory } from "./queries.ts";

/**
 * Edits the owner, due date, title and detail of one plan. Only a Pharmacy Manager reaches it (the row action is
 * gated), so the directory is read here. Only the changed fields are sent.
 */
export const EditPlanDrawer = ({ plan, onClose }: { plan: ActionPlan; onClose: () => void }): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = todayIsoDate();
  const directory = useStaffDirectory(true);
  const [initial] = useState(() => planFormValues(plan));
  const [values, setValues] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const issues = validatePlanForm(values, today, plan);

  const save = useMutation({
    mutationFn: (body: JsonRecord) => writeJson<unknown>(actionPlanPath(plan.id), "PATCH", body),
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
    const body = planPatchBody(plan, values);
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    save.mutate(body);
  };

  return (
    <FormDrawer
      title="Edit action plan"
      formId="action-plan-edit-form"
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
      />
    </FormDrawer>
  );
};
