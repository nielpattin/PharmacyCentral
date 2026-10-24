import { Alert, Button, RowActions } from "@pharmacy/ui";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { DataTable, type Column } from "../../components/data-table.tsx";
import { useConfirm, usePrompt } from "../../components/confirm.tsx";
import { PageActions } from "../../components/page-actions.tsx";
import { useHotkey } from "../../hooks/useHotkey.ts";
import { useStaffAction } from "../../hooks/useStaffAction.ts";
import { translateText } from "../../i18n.ts";
import { governanceTabPaths } from "../../router.ts";
import { text } from "../../staff-api.ts";
import { filterEmployees, toEmployeeAccount, type EmployeeAccount } from "./employees.ts";
import { useEmployees } from "./queries.ts";

/** Employee accounts: search, access, password reset, and session revocation. */
export const UsersTab = (): React.JSX.Element => {
  const navigate = useNavigate();
  const employees = useEmployees();
  const run = useStaffAction();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useHotkey(
    "/",
    (event) => {
      event.preventDefault();
      rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    },
    { label: "Focus search" },
  );
  useHotkey("n", () => void navigate({ to: governanceTabPaths.createUser }), { label: "Create new" });

  const rows = filterEmployees(employees.data ?? [], query);

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
    { key: "email", label: "Email", truncate: 32 },
    {
      key: "roles",
      label: "Roles",
      render: (row) =>
        toEmployeeAccount(row)
          .roles.map((role) => translateText(role))
          .join(", "),
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate({ to: governanceTabPaths.editAccess, search: { user: account.id } })}
            >
              {translateText("Edit access")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void resetPassword(account)}>
              {translateText("Reset password")}
            </Button>
            <Button variant="danger-soft" size="sm" onClick={() => void revokeSessions(account)}>
              {translateText("Revoke sessions")}
            </Button>
          </RowActions>
        );
      },
    },
  ];

  return (
    <div ref={rootRef} className="grid gap-4">
      <PageActions>
        <Button size="sm" onClick={() => void navigate({ to: governanceTabPaths.createUser })}>
          {translateText("Create user")}
        </Button>
      </PageActions>
      {employees.error ? <Alert variant="danger">{translateText(employees.error.message)}</Alert> : null}
      <DataTable
        rows={rows}
        columns={columns}
        getKey={(row, index) => text(row.id, String(index))}
        loading={employees.isPending}
        empty={query.trim() ? "No employees match this search." : "No employees found."}
        search={{ value: query, onChange: setQuery, placeholder: translateText("Search name or email") }}
        storageKey="staff:governance:users"
        exportCsv={{ filename: "employees.csv", columns: ["displayName", "email", "roles"] }}
      />
    </div>
  );
};
