import { AdminView } from "./dashboard/admin-view.tsx";
import { OperationsView } from "./dashboard/operations-view.tsx";
import { dashboardPersona } from "./dashboard/persona.ts";

/**
 * The dashboard, one view per kind of employee: the Pharmacy Manager and Warehouse Staff work the stock and approvals
 * of their sites, Platform Admin runs the platform. The Pharmacist has no dashboard and never gets here (the section is
 * closed to that role); an account with no matching role renders nothing.
 */
export const DashboardSection = ({ roles }: { roles: readonly string[] }): React.JSX.Element | null => {
  const persona = dashboardPersona(roles);
  if (persona === "admin") return <AdminView roles={roles} />;
  if (persona) return <OperationsView roles={roles} persona={persona} />;
  return null;
};
