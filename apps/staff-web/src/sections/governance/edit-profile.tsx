import { useForm, useStore } from "@tanstack/react-form";

import { Field } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { phoneProblem } from "../account/account-form.ts";
import { employeeLabel, type EmployeeAccount } from "./employees.ts";
import { employeesQueryKey } from "./queries.ts";

/**
 * Corrects the name and phone of another employee, for example after the person changed number. Mount it only while it
 * should be open. An administrator edits their own profile on Account settings, so the row offers no such action.
 */
export const EditProfileDrawer = ({
  account,
  onClose,
}: {
  account: EmployeeAccount;
  onClose: () => void;
}): React.JSX.Element => {
  const run = useStaffAction();
  const form = useForm({
    defaultValues: { displayName: account.displayName, phoneNumber: account.phoneNumber },
    onSubmit: async ({ value }) => {
      const saved = await run({
        path: `/api/admin/users/${account.id}/profile`,
        method: "PUT",
        body: { displayName: value.displayName.trim(), phoneNumber: value.phoneNumber.trim() },
        invalidate: [employeesQueryKey],
        success: "Employee profile updated.",
      });
      if (saved) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);

  return (
    <FormDrawer
      title="Edit employee profile"
      subtitle={employeeLabel(account)}
      formId="governance-edit-profile-form"
      submitLabel="Save profile"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      <form.Field name="displayName">
        {(field) => <Field label="Display name" required value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field
        name="phoneNumber"
        validators={{ onChange: ({ value }) => phoneProblem(value), onSubmit: ({ value }) => phoneProblem(value) }}
      >
        {(field) => (
          <Field
            label="Phone number"
            type="tel"
            autoComplete="off"
            required
            hint={
              field.state.meta.errors.length > 0
                ? String(field.state.meta.errors[0])
                : "Digits and + ( ) - only, 8 to 20 characters."
            }
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
    </FormDrawer>
  );
};
