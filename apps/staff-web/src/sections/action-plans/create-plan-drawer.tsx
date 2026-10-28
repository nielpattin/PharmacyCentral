import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, Button, useToast } from "@pharmacy/ui";
import { useState } from "react";

import { useSession } from "../../auth.ts";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { pathForSection } from "../../router.ts";
import { writeJson, type JsonRecord } from "../../staff-api.ts";
import { ACTION_PLANS_KEY, ACTION_PLANS_PATH } from "./contract.ts";
import type { ActionPlanDraft } from "./drafts.ts";
import { createFormValues, createPlanBody, samePlanForm, validatePlanForm } from "./form.ts";
import { PlanFields } from "./plan-fields.tsx";
import { canReadStaffDirectory, ownerOptionsFor } from "./owners.ts";
import { planWriteProblem, type PlanWriteProblem } from "./problems.ts";
import { todayIsoDate } from "./plan-state.ts";
import { useStaffDirectory } from "./queries.ts";

/**
 * Creates one action plan from a prefilled draft. The source, site and product come from the draft; the owner and due
 * date are the staff member's choice, and the title and detail may be edited first. Mount it only while it is open.
 */
export const CreatePlanDrawer = ({
  draft,
  onClose,
}: {
  draft: ActionPlanDraft;
  onClose: () => void;
}): React.JSX.Element => {
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const today = todayIsoDate();
  const directory = useStaffDirectory(canReadStaffDirectory(session));
  const [initial] = useState(() => createFormValues(draft, today));
  const [values, setValues] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [problem, setProblem] = useState<PlanWriteProblem>();
  const issues = validatePlanForm(values, today);
  const existingPlanId = problem?.existingPlanId;

  const create = useMutation({
    mutationFn: (body: JsonRecord) => writeJson<unknown>(ACTION_PLANS_PATH, "POST", body),
    onSuccess: async () => {
      toast.success(translateText("Action plan created."));
      await queryClient.invalidateQueries({ queryKey: ACTION_PLANS_KEY });
      onClose();
    },
    onError: (reason) => setProblem(planWriteProblem(reason)),
  });

  const submit = (): void => {
    setAttempted(true);
    if (issues.length > 0) return;
    setProblem(undefined);
    create.mutate(createPlanBody(draft, values));
  };

  // The plan that blocks this one is listed in the plans page, filtered to show it alone.
  const openExisting = (planId: string): void => {
    void navigate({ to: pathForSection("actionPlans"), search: { plan: planId } });
  };

  return (
    <FormDrawer
      title="Create action plan"
      formId="action-plan-create-form"
      submitLabel="Create plan"
      isDirty={!samePlanForm(values, initial)}
      onSubmit={submit}
      onClose={onClose}
    >
      {problem ? (
        <div className="sm:col-span-2">
          <Alert variant="danger" className="flex flex-wrap items-center gap-3">
            <span>{problem.message}</span>
            {existingPlanId ? (
              <Button size="sm" variant="outline" onClick={() => openExisting(existingPlanId)}>
                {translateText("Open the existing plan")}
              </Button>
            ) : null}
          </Alert>
        </div>
      ) : null}
      <PlanFields
        values={values}
        onChange={setValues}
        issues={attempted ? issues : []}
        owners={ownerOptionsFor(directory.data ?? [], draft.siteId)}
        today={today}
      />
    </FormDrawer>
  );
};
