import { useNavigate } from "@tanstack/react-router";

import { SubTabs } from "../components/forms.tsx";
import { governanceTabPaths } from "../router.ts";
import { AuditTab } from "./governance/audit.tsx";
import { UsersTab } from "./governance/users.tsx";

export type GovernanceTab = "Audit" | "Users";

/**
 * Governance pages. Each tab is its own route, so the tab in the URL is the one shown. Creating an account and editing
 * its access are drawers opened from Users, not tabs.
 */
export const GovernanceSection = ({ initialTab = "Audit" }: { initialTab?: GovernanceTab }): React.JSX.Element => {
  const navigate = useNavigate();
  // Read inside the component: router.ts imports the app, which imports this file, so it is not ready at load time.
  const tabPaths = { Audit: governanceTabPaths.audit, Users: governanceTabPaths.users } as const;
  return (
    <div className="grid gap-3">
      <SubTabs
        tabs={Object.keys(tabPaths)}
        active={initialTab}
        onChange={(tab) => void navigate({ to: tabPaths[tab as GovernanceTab] })}
      />
      {initialTab === "Audit" ? <AuditTab /> : null}
      {initialTab === "Users" ? <UsersTab /> : null}
    </div>
  );
};
