import { Link } from "@tanstack/react-router";

import { translateText } from "../i18n.ts";
import { governanceTabPaths, type GovernancePath } from "../router.ts";
import { AuditTab } from "./governance/audit.tsx";
import { CreateUserTab } from "./governance/create-user.tsx";
import { EditAccessTab } from "./governance/edit-access.tsx";
import { UsersTab } from "./governance/users.tsx";

export type GovernanceTab = "Audit" | "Users" | "Create user" | "Edit access";

/** Each tab is its own route, so the tab in the URL is the one shown. The paths live in router.ts. */
export const GovernanceSection = ({ initialTab = "Audit" }: { initialTab?: GovernanceTab }): React.JSX.Element => {
  const tabs: Array<{ tab: GovernanceTab; path: GovernancePath }> = [
    { tab: "Audit", path: governanceTabPaths.audit },
    { tab: "Users", path: governanceTabPaths.users },
    { tab: "Create user", path: governanceTabPaths.createUser },
    { tab: "Edit access", path: governanceTabPaths.editAccess },
  ];
  return (
    <div className="grid gap-4">
      <nav
        aria-label={translateText("Governance")}
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-line bg-surface-soft p-1"
      >
        {tabs.map(({ tab, path }) => {
          const active = tab === initialTab;
          return (
            <Link
              key={tab}
              to={path}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-surface px-3 py-1.5 text-xs font-bold text-primary shadow-sm"
                  : "rounded-md px-3 py-1.5 text-xs font-bold text-muted hover:text-ink"
              }
            >
              {translateText(tab)}
            </Link>
          );
        })}
      </nav>
      {initialTab === "Audit" ? <AuditTab /> : null}
      {initialTab === "Users" ? <UsersTab /> : null}
      {initialTab === "Create user" ? <CreateUserTab /> : null}
      {initialTab === "Edit access" ? <EditAccessTab /> : null}
    </div>
  );
};
