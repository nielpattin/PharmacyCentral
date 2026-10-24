import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from "@pharmacy/ui";
import { useForm, useStore } from "@tanstack/react-form";
import { useRef } from "react";

import { useHotkey } from "../../hooks/useHotkey.ts";
import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard.ts";
import { translateText } from "../../i18n.ts";
import { MultiChoice } from "./access-fields.tsx";
import { employeesQueryKey, useRoles } from "./queries.ts";

const PASSWORD_MIN_LENGTH = 12;

const initialValues = {
  email: "",
  password: "",
  displayName: "",
  roles: [] as string[],
  siteIds: [] as string[],
};

/** Creates an employee account. The password is typed hidden and must be at least 12 characters. */
export const CreateUserTab = (): React.JSX.Element => {
  const roles = useRoles();
  const references = useStaffReferences();
  const run = useStaffAction();
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value, formApi }) => {
      const created = await run({
        path: "/api/admin/users",
        body: {
          email: value.email,
          password: value.password,
          displayName: value.displayName,
          roles: value.roles,
          siteIds: value.siteIds,
        },
        invalidate: [employeesQueryKey],
        success: "Employee account created.",
      });
      if (created) formApi.reset(initialValues);
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
  const roleOptions = (roles.data ?? []).map((role) => ({ value: role, label: role }));
  const siteOptions = referenceOptions(references.sites, ["code", "name"]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translateText("Create employee account")}</CardTitle>
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
          <form.Field name="email">
            {(field) => (
              <Field label={translateText("Email")}>
                <Input
                  type="email"
                  autoComplete="off"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="displayName">
            {(field) => (
              <Field label={translateText("Display name")}>
                <Input
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <Field
                label={translateText("Password")}
                hint={`${translateText("Minimum length")}: ${PASSWORD_MIN_LENGTH}`}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
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
            <Button type="submit">{translateText("Create employee")}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
