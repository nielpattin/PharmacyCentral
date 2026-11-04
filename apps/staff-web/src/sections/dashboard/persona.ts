/** Which dashboard a signed-in employee gets. The Pharmacist has no dashboard; the counter overview is theirs. */
export type DashboardPersona = "manager" | "warehouse" | "admin";

/**
 * The working role wins over the administrator one: an account that holds Platform Admin and another role keeps the
 * rights of the other role (ADR 0019), so it gets that role's dashboard. Platform Admin alone gets the platform view.
 * Returns undefined for a role set that has no dashboard.
 */
export const dashboardPersona = (roles: readonly string[]): DashboardPersona | undefined => {
  if (roles.includes("Pharmacy Manager")) return "manager";
  if (roles.includes("Warehouse Staff")) return "warehouse";
  if (roles.includes("Platform Admin")) return "admin";
  return undefined;
};
