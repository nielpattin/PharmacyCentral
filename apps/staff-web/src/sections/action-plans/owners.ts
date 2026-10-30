import { hasStaffRole } from "../../permissions/staff-permissions.ts";
import type { StaffEmployee } from "./contract.ts";

export type OwnerOption = { value: string; label: string };

/** The Pharmacy Manager and Platform Admin read the directory; the other roles never see it. */
export const canReadStaffDirectory = (session: { roles?: readonly string[] | undefined }): boolean =>
  hasStaffRole(session.roles ?? [], ["Pharmacy Manager", "Platform Admin"]);

/**
 * The owners a plan at `siteId` may name: an employee who works at that site, and a Platform Admin, who passes the
 * site check as the server does. A plan with no site lists every employee. `currentOwnerId` stays listed when the
 * directory no longer holds it, so the form still shows the saved owner.
 */
export const ownerOptionsFor = (
  employees: readonly StaffEmployee[],
  siteId: string | null | undefined,
  currentOwnerId?: string,
): OwnerOption[] => {
  const options: OwnerOption[] = employees
    .filter(
      (employee) =>
        siteId === undefined ||
        siteId === null ||
        employee.roles.includes("Platform Admin") ||
        employee.siteIds.includes(siteId),
    )
    .map((employee) => ({ value: employee.id, label: employee.displayName }));
  if (currentOwnerId !== undefined && !options.some((option) => option.value === currentOwnerId)) {
    options.push({ value: currentOwnerId, label: currentOwnerId.slice(0, 8).toUpperCase() });
  }
  return options.sort((left, right) => left.label.localeCompare(right.label, "vi"));
};

export type ViewerIdentity = { userId?: string | undefined; displayName?: string | undefined };

/**
 * The name shown for a plan's owner: the directory's name when the directory holds the owner, else the viewer's own
 * name when the viewer is the owner (a non-manager sees no directory), else the short id.
 */
export const ownerNameOf = (ownerId: string, employees: readonly StaffEmployee[], viewer: ViewerIdentity): string => {
  const employee = employees.find((candidate) => candidate.id === ownerId);
  if (employee) return employee.displayName;
  if (viewer.userId === ownerId && viewer.displayName) return viewer.displayName;
  return ownerId.slice(0, 8).toUpperCase();
};
