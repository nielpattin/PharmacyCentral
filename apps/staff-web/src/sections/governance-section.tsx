import { useState } from "react";

import { DataTable } from "../components/data-table.tsx";
import { Field, FormCard, MultiSelectField, RefreshButton, SelectField, SubTabs } from "../components/forms.tsx";
import { useMountEffect } from "../hooks/useMountEffect.ts";
import { translateText } from "../i18n.ts";
import { referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { readOne, readRows, text, writeJson, type JsonRecord } from "../staff-api.ts";

const userInitial = {
  email: "",
  password: "DemoPassword123!",
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
  const [audit, setAudit] = useState<JsonRecord[]>([]);
  const [users, setUsers] = useState<JsonRecord[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [user, setUser] = useState(userInitial);
  const [access, setAccess] = useState(accessInitial);
  const [auditFilters, setAuditFilters] = useState(auditInitial);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const references = useStaffReferences();
  const load = async (): Promise<void> => {
    try {
      setError(undefined);
      const query = new URLSearchParams(Object.entries(auditFilters).filter(([, value]) => value.length > 0));
      const [nextAudit, nextUsers, roleResult] = await Promise.all([
        readRows(`/api/audit/logs?${query.toString()}`),
        readRows("/api/admin/users"),
        readOne<JsonRecord>("/api/admin/roles"),
      ]);
      setAudit(nextAudit);
      setUsers(nextUsers);
      setRoles(
        Array.isArray(roleResult.roles)
          ? roleResult.roles.filter((role): role is string => typeof role === "string")
          : [],
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load governance data");
    }
  };
  useMountEffect(() => {
    void load();
  });
  const setValue =
    (key: "email" | "password" | "displayName") =>
    (value: string): void =>
      setUser((current) => ({ ...current, [key]: value }));
  const createUser = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await writeJson("/api/admin/users", "POST", {
        email: user.email,
        password: user.password,
        displayName: user.displayName,
        roles: user.roles,
        siteIds: user.siteIds,
      });
      setUser(userInitial);
      setMessage("Employee account created.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create employee");
    }
  };
  const updateAccess = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await writeJson(`/api/admin/users/${access.id}/access`, "PUT", { roles: access.roles, siteIds: access.siteIds });
      setMessage("Employee access updated.");
      setTab("Users");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update employee access");
    }
  };
  const editAccess = (row: JsonRecord): void => {
    setAccess({ id: text(row.id, ""), roles: strings(row.roles), siteIds: strings(row.siteIds) });
    setTab("Edit access");
  };
  const revoke = async (id: string): Promise<void> => {
    try {
      await writeJson(`/api/admin/users/${id}/revoke-sessions`, "POST");
      setMessage("Sessions revoked.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revoke sessions");
    }
  };
  const reset = async (id: string): Promise<void> => {
    const password = window.prompt(translateText("New password, at least 12 characters:"), "DemoPassword123!");
    if (!password) return;
    try {
      await writeJson(`/api/admin/users/${id}/reset-password`, "POST", { password });
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
      {error ? <p className="notice">{translateText(error)}</p> : null}
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
        <FormCard title="Edit employee access" onSubmit={(event) => void updateAccess(event)} submitLabel="Save access">
          <MultiSelectField
            label="Roles"
            value={access.roles}
            onChange={(value) => setAccess((current) => ({ ...current, roles: value }))}
            options={roles.map((role) => ({ value: role, label: role }))}
            required
          />
          <MultiSelectField
            label="Site access"
            value={access.siteIds}
            onChange={(value) => setAccess((current) => ({ ...current, siteIds: value }))}
            options={referenceOptions(references.sites, ["code", "name"])}
          />
        </FormCard>
      ) : null}
      {tab === "Create user" ? (
        <FormCard
          title="Create employee account"
          onSubmit={(event) => void createUser(event)}
          submitLabel="Create employee"
        >
          <Field label="Email" type="email" value={user.email} onChange={setValue("email")} required />
          <Field label="Password" value={user.password} onChange={setValue("password")} required />
          <Field label="Display name" value={user.displayName} onChange={setValue("displayName")} required />
          <MultiSelectField
            label="Roles"
            value={user.roles}
            onChange={(value) => setUser((current) => ({ ...current, roles: value }))}
            options={roles.map((role) => ({ value: role, label: role }))}
            required
          />
          <MultiSelectField
            label="Site access"
            value={user.siteIds}
            onChange={(value) => setUser((current) => ({ ...current, siteIds: value }))}
            options={referenceOptions(references.sites, ["code", "name"])}
          />
        </FormCard>
      ) : null}
    </section>
  );
};
