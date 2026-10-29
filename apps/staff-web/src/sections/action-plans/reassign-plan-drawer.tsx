import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Field as UiField, Select, useToast } from "@pharmacy/ui";
import { useState } from "react";

import { FormDrawer } from "../../components/form-drawer.tsx";
import { translateText } from "../../i18n.ts";
import { writeJson } from "../../staff-api.ts";
import { ACTION_PLANS_KEY, actionPlanPath, type ActionPlan } from "./contract.ts";
import { ownerOptionsFor } from "./owners.ts";
import { planWriteProblem } from "./problems.ts";
import { useStaffDirectory } from "./queries.ts";

/**
 * Gives one plan to another employee of its site (BR-PLAN-001). A manager assigns and changes nothing else: the title,
 * detail and due date come from the system, and the owner works the status. Only `ownerId` is sent.
 */
export const ReassignPlanDrawer = ({ plan, onClose }: { plan: ActionPlan; onClose: () => void }): React.JSX.Element => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const directory = useStaffDirectory(true);
  const [ownerId, setOwnerId] = useState(plan.ownerId);
  const [attempted, setAttempted] = useState(false);

  const save = useMutation({
    mutationFn: () => writeJson<unknown>(actionPlanPath(plan.id), "PATCH", { ownerId }),
    onSuccess: async () => {
      toast.success(translateText("Action plan saved."));
      await queryClient.invalidateQueries({ queryKey: ACTION_PLANS_KEY });
      onClose();
    },
    onError: (reason) => toast.error(planWriteProblem(reason).message),
  });

  const submit = (): void => {
    setAttempted(true);
    if (ownerId === "") return;
    if (ownerId === plan.ownerId) {
      onClose();
      return;
    }
    save.mutate();
  };

  return (
    <FormDrawer
      title="Reassign action plan"
      subtitle={plan.title}
      formId="action-plan-reassign-form"
      submitLabel="Save changes"
      isDirty={ownerId !== plan.ownerId}
      onSubmit={submit}
      onClose={onClose}
    >
      <div className="grid content-start gap-1.5 sm:col-span-2">
        <UiField label={translateText("Owner")}>
          <Select value={ownerId} required onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">{translateText("Select...")}</option>
            {ownerOptionsFor(directory.data ?? [], plan.siteId, plan.ownerId).map((owner) => (
              <option key={owner.value} value={owner.value}>
                {owner.label}
              </option>
            ))}
          </Select>
        </UiField>
        {attempted && ownerId === "" ? (
          <span className="text-xs text-danger-ink">{translateText("Choose an owner.")}</span>
        ) : null}
      </div>
    </FormDrawer>
  );
};
