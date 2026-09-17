import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, MultiSelectField, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { useStaffMutation } from "../hooks/useStaffMutation.ts";
import { readOne, readRows, text, type JsonRecord } from "../staff-api.ts";

const userInitial = {
  email: "",
  password: "",
  displayName: "",
  roles: [] as string[],
  siteIds: [] as string[],
};
const accessInitial = { id: "", roles: [] as string[], siteIds: [] as string[] };
const auditInitial = { userId: "", siteId: "", entityType: "", entityId: "", action: "", limit: "200" };
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const GovernanceSection = ({
  initialTab = "Audit",
}: {
  initialTab?: "Audit" | "Users" | "Create user" | "Edit access";
}): React.JSX.Element => {
  const [tab, setTab] = useState<string>(initialTab);
  const [auditFilters, setAuditFilters] = useState(auditInitial);
  const governanceQuery = useQuery({
    queryKey: ["governance", auditFilters],
    queryFn: async () => {
      const query = new URLSearchParams(Object.entries(auditFilters).filter(([, value]) => value.length > 0));
      const [audit, users, roleResult] = await Promise.all([
        readRows("/api/audit/logs?" + query.toString()),
        readRows("/api/admin/users"),
        readOne<JsonRecord>("/api/admin/roles"),
      ]);
      const roles = Array.isArray(roleResult.roles)
        ? roleResult.roles.filter((role): role is string => typeof role === "string")
        : [];
      return { audit, users, roles };
    },
  });
  const audit = governanceQuery.data?.audit ?? [];
  const users = governanceQuery.data?.users ?? [];
  const roles = governanceQuery.data?.roles ?? [];
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const mutation = useStaffMutation();
  const load = async (): Promise<void> => {
    setError(undefined);
    try {
      const result = await governanceQuery.refetch();
      if (result.error) throw result.error;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load governance data");
    }
  };
  const visibleError = error ?? (governanceQuery.error instanceof Error ? governanceQuery.error.message : undefined);
  const userForm = useForm({
    defaultValues: userInitial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          path: "/api/admin/users",
          method: "POST",
          body: {
            email: value.email,
            password: value.password,
            displayName: value.displayName,
            roles: value.roles,
            siteIds: value.siteIds,
          },
          invalidate: [["governance"]],
        });
        userForm.reset(userInitial);
        setMessage("Employee account created.");
        setError(undefined);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to create employee");
      }
    },
  });
  const accessForm = useForm({
    defaultValues: accessInitial,
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync({
          path: `/api/admin/users/${value.id}/access`,
          method: "PUT",
          body: { roles: value.roles, siteIds: value.siteIds },
          invalidate: [["governance"]],
        });
        setMessage("Employee access updated.");
        setError(undefined);
        setTab("Users");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to update employee access");
      }
    },
  });
  const editAccess = (row: JsonRecord): void => {
    accessForm.reset({ id: text(row.id, ""), roles: strings(row.roles), siteIds: strings(row.siteIds) });
    setTab("Edit access");
  };
  const revoke = async (id: string): Promise<void> => {
    try {
      await mutation.mutateAsync({
        path: `/api/admin/users/${id}/revoke-sessions`,
        method: "POST",
        invalidate: [["governance"]],
      });
      setMessage("Sessions revoked.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revoke sessions");
    }
  };
  const reset = async (id: string): Promise<void> => {
    const password = window.prompt(translateText("New password, at least 12 characters:"));
    if (!password) return;
    try {
      await mutation.mutateAsync({
        path: `/api/admin/users/${id}/reset-password`,
        method: "POST",
        body: { password },
        invalidate: [["governance"]],
      });
      setMessage("Password reset.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset password");
    }
  };
  return (
    <section className="staff-section">
      <div className="page-head">
        <div>
          <h2>{translateText("Governance")}</h2>
          <p className="page-subtitle">{translateText("Audit activity and employee access controls.")}</p>
        </div>
        <RefreshButton onClick={() => void load()} />
      </div>
      {visibleError ? <p className="notice">{translateText(visibleError)}</p> : null}
      {references.error ? <p className="notice">{translateText(references.error)}</p> : null}
      {message ? <p className="success-note">{translateText(message)}</p> : null}
      <SubTabs tabs={["Audit", "Users", "Create user", "Edit access"]} active={tab} onChange={setTab} />
      {tab === "Audit" ? (
        <>
          <div className="filter-grid">
            <Field
              label="User ID"
              value={auditFilters.userId}
              onChange={(value) => setAuditFilters((current) => ({ ...current, userId: value }))}
            />
            <SelectField
              label="Site"
              value={auditFilters.siteId}
              onChange={(value) => setAuditFilters((current) => ({ ...current, siteId: value }))}
              options={referenceOptions(references.sites, ["code", "name"])}
            />
            <Field
              label="Entity type"
              value={auditFilters.entityType}
              onChange={(value) => setAuditFilters((current) => ({ ...current, entityType: value }))}
            />
            <Field
              label="Entity ID"
              value={auditFilters.entityId}
              onChange={(value) => setAuditFilters((current) => ({ ...current, entityId: value }))}
            />
            <Field
              label="Action"
              value={auditFilters.action}
              onChange={(value) => setAuditFilters((current) => ({ ...current, action: value }))}
            />
            <Field
              label="Limit"
              type="number"
              value={auditFilters.limit}
              onChange={(value) => setAuditFilters((current) => ({ ...current, limit: value }))}
            />
            <button className="primary-button" type="button" onClick={() => void load()}>
              {translateText("Apply filters")}
            </button>
          </div>
          <DataTable
            rows={audit}
            columns={[
              { key: "action", label: "Action" },
              { key: "entityType", label: "Entity" },
              { key: "actorId", label: "Actor" },
              { key: "siteId", label: "Site" },
              { key: "occurredAt", label: "Occurred" },
              { key: "payload", label: "Details", render: (row) => <code>{JSON.stringify(row.payload ?? {})}</code> },
            ]}
          />
        </>
      ) : null}
      {tab === "Users" ? (
        <DataTable
          rows={users}
          columns={[
            { key: "email", label: "Email" },
            { key: "displayName", label: "Name" },
            {
              key: "roles",
              label: "Roles",
              render: (row) => text(Array.isArray(row.roles) ? row.roles.join(", ") : row.roles),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span className="row-actions">
                  <button className="ghost-button small" type="button" onClick={() => editAccess(row)}>
                    {translateText("Access")}
                  </button>
                  <button className="ghost-button small" type="button" onClick={() => void reset(text(row.id))}>
                    {translateText("Reset password")}
                  </button>
                  <button className="danger-button" type="button" onClick={() => void revoke(text(row.id))}>
                    {translateText("Revoke sessions")}
                  </button>
                </span>
              ),
            },
          ]}
        />
      ) : null}
      {tab === "Edit access" ? (
        <FormCard
          title="Edit employee access"
          onSubmit={(event) => {
            event.preventDefault();
            void accessForm.handleSubmit();
          }}
          submitLabel="Save access"
        >
          <accessForm.Field name="roles">
            {(field) => (
              <MultiSelectField
                label="Roles"
                value={field.state.value}
                onChange={field.handleChange}
                options={roles.map((role) => ({ value: role, label: role }))}
                required
              />
            )}
          </accessForm.Field>
          <accessForm.Field name="siteIds">
            {(field) => (
              <MultiSelectField
                label="Site access"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
              />
            )}
          </accessForm.Field>
        </FormCard>
      ) : null}
      {tab === "Create user" ? (
        <FormCard
          title="Create employee account"
          onSubmit={(event) => {
            event.preventDefault();
            void userForm.handleSubmit();
          }}
          submitLabel="Create employee"
        >
          <userForm.Field name="email">
            {(field) => (
              <Field label="Email" type="email" value={field.state.value} onChange={field.handleChange} required />
            )}
          </userForm.Field>
          <userForm.Field name="password">
            {(field) => <Field label="Password" value={field.state.value} onChange={field.handleChange} required />}
          </userForm.Field>
          <userForm.Field name="displayName">
            {(field) => <Field label="Display name" value={field.state.value} onChange={field.handleChange} required />}
          </userForm.Field>
          <userForm.Field name="roles">
            {(field) => (
              <MultiSelectField
                label="Roles"
                value={field.state.value}
                onChange={field.handleChange}
                options={roles.map((role) => ({ value: role, label: role }))}
                required
              />
            )}
          </userForm.Field>
          <userForm.Field name="siteIds">
            {(field) => (
              <MultiSelectField
                label="Site access"
                value={field.state.value}
                onChange={field.handleChange}
                options={referenceOptions(references.sites, ["code", "name"])}
              />
            )}
          </userForm.Field>
        </FormCard>
      ) : null}
    </section>
  );
};
