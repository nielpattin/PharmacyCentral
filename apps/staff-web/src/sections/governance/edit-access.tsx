import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Select } from "@pharmacy/ui";
import { useForm, useStore } from "@tanstack/react-form";
import { useRef } from "react";

import { useHotkey } from "../../hooks/useHotkey.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { MultiChoice } from "./access-fields.tsx";
import { employeeLabel, toEmployeeAccount, type EmployeeAccount } from "./employees.ts";
import { employeesQueryKey, useEmployees, useRoles } from "./queries.ts";

const EDIT_ACCESS_DEFAULTS = { user: "" } as const;

/** Roles and site access of one employee. The employee is chosen in the URL (`?user=`), so a link can open it. */
export const EditAccessTab = (): React.JSX.Element => {
  const { values, setValues } = useListUrlState(EDIT_ACCESS_DEFAULTS);
  const employees = useEmployees();
  const roles = useRoles();
  const references = useStaffReferences();
  const accounts = (employees.data ?? []).map(toEmployeeAccount);
  const selected = accounts.find((account) => account.id === values.user);
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role, label: role }));
  const siteOptions = referenceOptions(references.sites, ["code", "name"]);

  return (
    <div className="grid gap-4">
      <Field label={translateText("Employee")}>
        <Select value={values.user} onChange={(event) => setValues({ user: event.target.value })}>
          <option value="">{translateText("Select an employee")}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {employeeLabel(account)}
            </option>
          ))}
        </Select>
      </Field>
      {employees.error ? <Alert variant="danger">{translateText(employees.error.message)}</Alert> : null}
      {selected ? (
        <AccessForm key={selected.id} account={selected} roleOptions={roleOptions} siteOptions={siteOptions} />
      ) : (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
          {translateText("Select an employee to edit their access.")}
        </p>
      )}
    </div>
  );
};

type AccessFormProps = {
  account: EmployeeAccount;
  roleOptions: Array<{ value: string; label: string }>;
  siteOptions: Array<{ value: string; label: string }>;
};

/** Keyed by employee, so switching employees starts from that employee's saved access. */
const AccessForm = ({ account, roleOptions, siteOptions }: AccessFormProps): React.JSX.Element => {
  const run = useStaffAction();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: { roles: account.roles, siteIds: account.siteIds },
    onSubmit: async ({ value, formApi }) => {
      const saved = await run({
        path: `/api/admin/users/${account.id}/access`,
        method: "PUT",
        body: { roles: value.roles, siteIds: value.siteIds },
        invalidate: [employeesQueryKey],
        success: "Employee access updated.",
      });
      // The saved values become the new baseline, so the form is clean and the guard lets the next navigation pass.
      if (saved) formApi.reset(value);
    },
  });
  const isDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isDirty);
  useHotkey(
    "mod+s",
    (event) => {
      event.preventDefault();
      formRef.current?.requestSubmit();
    },
    { label: "Save", allowWhileEditing: true },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translateText("Edit employee access")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="roles">
            {(field) => (
              <MultiChoice
                label={translateText("Roles")}
                value={field.state.value}
                onChange={field.handleChange}
                options={roleOptions}
                required
              />
            )}
          </form.Field>
          <form.Field name="siteIds">
            {(field) => (
              <MultiChoice
                label={translateText("Site access")}
                value={field.state.value}
                onChange={field.handleChange}
                options={siteOptions}
              />
            )}
          </form.Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit">{translateText("Save access")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
