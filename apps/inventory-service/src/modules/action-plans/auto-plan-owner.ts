import type { ActiveEmployee } from "./identity-employee-client.ts";

const PHARMACIST = "Pharmacist";
const PHARMACY_MANAGER = "Pharmacy Manager";

/**
 * Who owns a plan the system creates (BR-PLAN-001). `employees` are the active employees who hold the plan's site.
 * The active Pharmacist with the fewest open or in-progress plans takes it; equal counts go to the first name in
 * alphabetical order (Vietnamese collation, then id so the pick is never random). A site with no Pharmacist falls back
 * to its Pharmacy Manager by the same rule. Undefined when the site has neither: no owner is guessed.
 */
export const pickPlanOwner = (
  employees: readonly ActiveEmployee[],
  openPlanCounts: ReadonlyMap<string, number>,
): ActiveEmployee | undefined => {
  const lightest = (role: string): ActiveEmployee | undefined =>
    employees
      .filter((employee) => employee.roles.includes(role))
      .sort(
        (a, b) =>
          (openPlanCounts.get(a.id) ?? 0) - (openPlanCounts.get(b.id) ?? 0) ||
          a.displayName.localeCompare(b.displayName, "vi") ||
          a.id.localeCompare(b.id),
      )[0];
  return lightest(PHARMACIST) ?? lightest(PHARMACY_MANAGER);
};
