/**
 * The catalog's role matrix, stated once. Platform Admin passes every rule except the rules that name it as excluded
 * (`platformAdminPasses: false`). Separation of duties is not a role: nobody approves a record they created, Platform
 * Admin included, and that is checked by `isSelfApproval` on the record itself.
 */
export const PLATFORM_ADMIN = "Platform Admin";
export const PHARMACY_MANAGER = "Pharmacy Manager";
export const PHARMACIST = "Pharmacist";

export type RoleRule = {
  readonly roles: readonly string[];
  /** False is the explicit exclusion: Platform Admin is refused even though it passes every other rule. */
  readonly platformAdminPasses: boolean;
};

export const ROLE_RULES = {
  /** Creating or deleting a site: Platform Admin only. */
  platformAdminOnly: { roles: [], platformAdminPasses: true },
  /** Catalog, reference data and price writes: Pharmacy Manager, and Platform Admin. */
  pharmacyManager: { roles: [PHARMACY_MANAGER], platformAdminPasses: true },
  /** Search synonym proposals, edits and deletes: Pharmacist, Pharmacy Manager and Platform Admin. */
  searchSynonymEditor: { roles: [PHARMACIST, PHARMACY_MANAGER], platformAdminPasses: true },
  /**
   * Approving a search synonym group. Platform Admin is excluded (Decision 1 of staff-search-synonyms): it proposes and
   * edits, but a second Pharmacist or Pharmacy Manager must approve.
   */
  searchSynonymApprover: { roles: [PHARMACIST, PHARMACY_MANAGER], platformAdminPasses: false },
} satisfies Record<string, RoleRule>;

export const holdsRole = (roles: readonly string[], rule: RoleRule): boolean =>
  (rule.platformAdminPasses && roles.includes(PLATFORM_ADMIN)) || rule.roles.some((role) => roles.includes(role));

/** True when the approver is the person who created, proposed or last edited the record. A record with no recorded maker can be approved by anyone with the role. */
export const isSelfApproval = (approverId: string, makerId: string | null | undefined): boolean =>
  makerId !== null && makerId !== undefined && makerId === approverId;
