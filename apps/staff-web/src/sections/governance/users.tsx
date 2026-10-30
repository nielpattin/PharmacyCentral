import { ActionMenu, Alert, Button, RowActions, Select, StatusCell, type ActionMenuItem } from "@pharmacy/ui";
import { useRef, useState } from "react";

import { useSession } from "../../auth.ts";
import { useConfirm, usePrompt } from "../../components/confirm.tsx";
import { DataTable, type Column } from "../../components/data-table.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { SavedViewsMenu } from "../../components/saved-views-menu.tsx";
import { useFocusSearchHotkey } from "../../hooks/useFocusSearchHotkey.ts";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useListUrlState } from "../../hooks/useListUrlState.ts";
import { useSearchDraft } from "../../hooks/useSearchDraft.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { text } from "../../staff-api.ts";
import { CreateUserDrawer } from "./create-user.tsx";
import { EditAccessDrawer } from "./edit-access.tsx";
import { EditProfileDrawer } from "./edit-profile.tsx";
import { filterEmployees, toEmployeeAccount, type EmployeeAccount } from "./employees.ts";
import { employeesQueryKey, useEmployees } from "./queries.ts";

const USERS_DEFAULTS = { q: "", status: "all" } as const;

const STATUS_FILTERS = ["all", "active", "deactivated"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const statusFilter = (value: string): StatusFilter => STATUS_FILTERS.find((item) => item === value) ?? "all";

/** Employee accounts: search, access, password reset, session revocation, deactivation and reactivation. */
export const UsersTab = (): React.JSX.Element => {
  const session = useSession();
  const { values, setValues } = useListUrlState(USERS_DEFAULTS);
  const status = statusFilter(values.status);
  const employees = useEmployees(status === "all" ? undefined : status);
  const run = useStaffAction();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [editingProfileId, setEditingProfileId] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusSearchHotkey(rootRef);
  useHotkey("n", () => setCreating(true), { label: "Create new" });

  const rows = filterEmployees(employees.data ?? [], values.q);
  const editing = (employees.data ?? []).map(toEmployeeAccount).find((account) => account.id === editingId);
  const editingProfile = (employees.data ?? [])
    .map(toEmployeeAccount)
    .find((account) => account.id === editingProfileId);

  const resetPassword = async (account: EmployeeAccount): Promise<void> => {
    const password = await prompt({
      title: "Reset password",
      description: "The employee signs in with this password. It must be at least 12 characters.",
      label: "New password",
      type: "password",
      required: true,
      minLength: 12,
      confirmLabel: "Reset password",
    });
    if (password === null) return;
    await run({
      path: `/api/admin/users/${account.id}/reset-password`,
      body: { password },
      success: "Password reset. The employee's sessions have been signed out.",
    });
  };

  const revokeSessions = async (account: EmployeeAccount): Promise<void> => {
    const accepted = await confirm({
      title: "Revoke sessions?",
      description: "Every active session of this employee ends. They must sign in again.",
      confirmLabel: "Revoke sessions",
      tone: "danger",
    });
    if (!accepted) return;
    await run({ path: `/api/admin/users/${account.id}/revoke-sessions`, success: "Sessions revoked." });
  };

  const deactivate = async (account: EmployeeAccount): Promise<void> => {
    const accepted = await confirm({
      title: "Deactivate account?",
      description:
        "The employee can no longer sign in and every active session ends. Roles, sites and history are kept.",
      confirmLabel: "Deactivate",
      tone: "danger",
    });
    if (!accepted) return;
    await run({
      path: `/api/admin/users/${account.id}/deactivate`,
      invalidate: [employeesQueryKey],
      success: "Account deactivated.",
    });
  };

  const activate = async (account: EmployeeAccount): Promise<void> => {
    await run({
      path: `/api/admin/users/${account.id}/activate`,
      invalidate: [employeesQueryKey],
      success: "Account reactivated.",
    });
  };

  const columns: Column[] = [
    { key: "displayName", label: "Name" },
    { key: "email", hideBelow: "md", label: "Email", truncate: 32 },
    {
      key: "phoneNumber",
      hideBelow: "lg",
      label: "Phone",
      render: (row) => toEmployeeAccount(row).phoneNumber || "—",
      text: (row) => toEmployeeAccount(row).phoneNumber,
    },
    {
      key: "roles",
      hideBelow: "lg",
      label: "Roles",
      render: (row) => {
        const roles = toEmployeeAccount(row).roles;
        return roles.length === 0 ? "—" : roles.map((role) => translateText(role)).join(", ");
      },
      text: (row) => toEmployeeAccount(row).roles.join(", "),
    },
    {
      key: "isActive",
      label: "Status",
      render: (row) =>
        toEmployeeAccount(row).isActive ? (
          <StatusCell tone="success">{translateText("Active")}</StatusCell>
        ) : (
          <StatusCell tone="neutral">{translateText("Deactivated")}</StatusCell>
        ),
      text: (row) => (toEmployeeAccount(row).isActive ? "Active" : "Deactivated"),
    },
    {
      key: "actions",
      label: "Actions",
      pinned: "right",
      align: "right",
      render: (row) => {
        const account = toEmployeeAccount(row);
        return (
          <RowActions label={translateText("Employee actions")}>
            <Button variant="ghost" size="sm" onClick={() => setEditingId(account.id)}>
              {translateText("Edit access")}
            </Button>
            <ActionMenu
              label={translateText("More actions")}
              items={
                [
                  ...(account.id === session.userId
                    ? []
                    : [
                        {
                          id: "profile",
                          label: translateText("Edit profile"),
                          onSelect: () => setEditingProfileId(account.id),
                        },
                      ]),
                  ...(account.isActive
                    ? [
                        {
                          id: "reset",
                          label: translateText("Reset password"),
                          onSelect: () => void resetPassword(account),
                        },
                        {
                          id: "revoke",
                          label: translateText("Revoke sessions"),
                          tone: "danger" as const,
                          onSelect: () => void revokeSessions(account),
                        },
                        ...(account.id === session.userId
                          ? []
                          : [
                              {
                                id: "deactivate",
                                label: translateText("Deactivate"),
                                tone: "danger" as const,
                                onSelect: () => void deactivate(account),
                              },
                            ]),
                      ]
                    : [{ id: "activate", label: translateText("Reactivate"), onSelect: () => void activate(account) }]),
                ] satisfies ActionMenuItem[]
              }
            />
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-3">
      <PageActions>
        <Button size="sm" onClick={() => setCreating(true)}>
          {translateText("Create user")}
        </Button>
      </PageActions>
      {employees.error ? <Alert variant="danger">{translateText(employees.error.message)}</Alert> : null}
      <DataTable
        rows={rows}
        columns={columns}
        getKey={(row, index) => text(row.id, String(index))}
        loading={employees.isPending}
        empty={values.q.trim() ? "No employees match this search." : "No employees found."}
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search name, email or phone") }}
        toolbarStart={
          <Select
            aria-label={translateText("Status")}
            className="w-auto min-w-44"
            value={status}
            onChange={(event) => setValues({ status: event.target.value })}
          >
            <option value="all">{translateText("All statuses")}</option>
            <option value="active">{translateText("Active")}</option>
            <option value="deactivated">{translateText("Deactivated")}</option>
          </Select>
        }
        toolbarExtra={<SavedViewsMenu pageKey="governance-users" defaults={USERS_DEFAULTS} />}
        storageKey="staff:governance:users"
        exportCsv={{ filename: "employees.csv", columns: ["displayName", "email", "phoneNumber", "roles"] }}
      />
      {creating ? <CreateUserDrawer onClose={() => setCreating(false)} /> : null}
      {editingProfile ? (
        <EditProfileDrawer
          key={editingProfile.id}
          account={editingProfile}
          onClose={() => setEditingProfileId(undefined)}
        />
      ) : null}
      {editing ? <EditAccessDrawer key={editing.id} account={editing} onClose={() => setEditingId(undefined)} /> : null}
    </div>
  );
};
