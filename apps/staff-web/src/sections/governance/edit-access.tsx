import { CheckboxGroup } from "@pharmacy/ui";
import { useForm, useStore } from "@tanstack/react-form";

import { FormDrawer } from "../../components/form-drawer.tsx";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { employeeLabel, type EmployeeAccount, requireRole } from "./employees.ts";
import { employeesQueryKey, useRoles } from "./queries.ts";

/** Roles and site access of one employee, in a side drawer. Mount it only while it should be open. */
export const EditAccessDrawer = ({
  account,
  onClose,
}: {
  account: EmployeeAccount;
  onClose: () => void;
}): React.JSX.Element => {
  const roles = useRoles();
  const references = useStaffReferences();
  const run = useStaffAction();
  const form = useForm({
    defaultValues: { roles: account.roles, siteIds: account.siteIds },
    onSubmit: async ({ value }) => {
      const saved = await run({
        path: `/api/admin/users/${account.id}/access`,
        method: "PUT",
        body: { roles: value.roles, siteIds: value.siteIds },
        invalidate: [employeesQueryKey],
        success: "Employee access updated.",
      });
      if (saved) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role, label: translateText(role) }));
  const siteOptions = referenceOptions(references.sites, ["code", "name"]);

  return (
    <FormDrawer
      title="Edit employee access"
      subtitle={employeeLabel(account)}
      formId="governance-edit-access-form"
      submitLabel="Save access"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      <form.Field name="roles" validators={{ onChange: requireRole, onSubmit: requireRole }}>
        {(field) => (
          <CheckboxGroup
            label={translateText("Roles")}
            options={roleOptions}
            value={field.state.value}
            onValueChange={field.handleChange}
            error={field.state.meta.errors.length > 0 ? translateText("Choose at least one role.") : undefined}
            required
          />
        )}
      </form.Field>
      <form.Field name="siteIds">
        {(field) => (
          <CheckboxGroup
            label={translateText("Site access")}
            options={siteOptions}
            value={field.state.value}
            onValueChange={field.handleChange}
            empty={translateText("No sites yet.")}
          />
        )}
      </form.Field>
    </FormDrawer>
  );
};
