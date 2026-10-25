import { ActionMenu, Alert, Button, RowActions } from "@pharmacy/ui";
import { useRef, useState } from "react";

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
import { filterEmployees, toEmployeeAccount, type EmployeeAccount } from "./employees.ts";
import { useEmployees } from "./queries.ts";

const USERS_DEFAULTS = { q: "" } as const;

/** Employee accounts: search, access, password reset, and session revocation. */
export const UsersTab = (): React.JSX.Element => {
  const employees = useEmployees();
  const run = useStaffAction();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { values, setValues } = useListUrlState(USERS_DEFAULTS);
  const [draft, setDraft] = useSearchDraft(values.q, (q) => setValues({ q }));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusSearchHotkey(rootRef);
  useHotkey("n", () => setCreating(true), { label: "Create new" });

  const rows = filterEmployees(employees.data ?? [], values.q);
  const editing = (employees.data ?? []).map(toEmployeeAccount).find((account) => account.id === editingId);

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
      success: "Password reset.",
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

  const columns: Column[] = [
    { key: "displayName", label: "Name" },
    { key: "email", hideBelow: "md", label: "Email", truncate: 32 },
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
              items={[
                { id: "reset", label: translateText("Reset password"), onSelect: () => void resetPassword(account) },
                {
                  id: "revoke",
                  label: translateText("Revoke sessions"),
                  tone: "danger",
                  onSelect: () => void revokeSessions(account),
                },
              ]}
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
        search={{ value: draft, onChange: setDraft, placeholder: translateText("Search name or email") }}
        toolbarExtra={<SavedViewsMenu pageKey="governance-users" defaults={USERS_DEFAULTS} />}
        storageKey="staff:governance:users"
        exportCsv={{ filename: "employees.csv", columns: ["displayName", "email", "roles"] }}
      />
      {creating ? <CreateUserDrawer onClose={() => setCreating(false)} /> : null}
      {editing ? <EditAccessDrawer key={editing.id} account={editing} onClose={() => setEditingId(undefined)} /> : null}
    </div>
  );
};
