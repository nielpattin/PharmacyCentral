import { CheckboxGroup, useToast } from "@pharmacy/ui";
import { useForm, useStore } from "@tanstack/react-form";

import { Field } from "../../components/forms.tsx";
import { FormDrawer } from "../../components/form-drawer.tsx";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { phoneProblem } from "../account/account-form.ts";
import { requireRole } from "./employees.ts";
import { employeesQueryKey, useRoles } from "./queries.ts";

const PASSWORD_MIN_LENGTH = 12;

const initialValues = {
  email: "",
  password: "",
  displayName: "",
  phoneNumber: "",
  roles: [] as string[],
  siteIds: [] as string[],
};

/**
 * Creates an employee account in a side drawer. The phone is required: colleagues and administrators reach a person
 * through it. The password is the temporary one the person replaces at the first sign-in (BR-USER-013).
 */
export const CreateUserDrawer = ({ onClose }: { onClose: () => void }): React.JSX.Element => {
  const roles = useRoles();
  const references = useStaffReferences();
  const run = useStaffAction();
  const toast = useToast();
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const problem = phoneProblem(value.phoneNumber);
      if (problem) {
        toast.error(translateText(problem));
        return;
      }
      const created = await run({
        path: "/api/admin/users",
        body: {
          email: value.email,
          password: value.password,
          displayName: value.displayName,
          phoneNumber: value.phoneNumber.trim(),
          roles: value.roles,
          siteIds: value.siteIds,
        },
        invalidate: [employeesQueryKey],
        success: "Employee account created.",
      });
      if (created) onClose();
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role, label: translateText(role) }));
  const siteOptions = referenceOptions(references.sites, ["code", "name"]);

  return (
    <FormDrawer
      title="Create employee account"
      formId="governance-create-user-form"
      submitLabel="Create employee"
      isDirty={isDirty}
      onSubmit={() => void form.handleSubmit()}
      onClose={onClose}
    >
      <form.Field name="email">
        {(field) => (
          <Field
            label="Email"
            type="email"
            autoComplete="off"
            required
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="displayName">
        {(field) => <Field label="Display name" required value={field.state.value} onChange={field.handleChange} />}
      </form.Field>
      <form.Field name="phoneNumber">
        {(field) => (
          <Field
            label="Phone number"
            type="tel"
            autoComplete="off"
            required
            hint="Digits and + ( ) - only, 8 to 20 characters."
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <Field
            label="Temporary password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            hint={`${translateText("Minimum length")}: ${PASSWORD_MIN_LENGTH}. ${translateText("The employee must replace it at the first sign-in.")}`}
            value={field.state.value}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field name="roles" validators={{ onChange: requireRole, onSubmit: requireRole }}>
        {(field) => (
          <CheckboxGroup
            label={translateText("Roles")}
            options={roleOptions}
            value={field.state.value}
            onValueChange={field.handleChange}
            error={field.state.meta.errors.length > 0 ? translateText("Choose at least one role.") : undefined}
            className="sm:col-span-2"
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
            className="sm:col-span-2"
            empty={translateText("No sites yet.")}
          />
        )}
      </form.Field>
    </FormDrawer>
  );
};
