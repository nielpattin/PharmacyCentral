/**
 * The catalog's role matrix, stated once. A rule names the roles that may act. Platform Admin reads every route a rule
 * guards and acts only where a rule names it. Separation of duties is not a role: nobody approves a record they
 * created, and that is checked by `isSelfApproval` on the record itself.
 */
export const PLATFORM_ADMIN = "Platform Admin";
export const PHARMACY_MANAGER = "Pharmacy Manager";
export const PHARMACIST = "Pharmacist";

export type RoleRule = {
  readonly roles: readonly string[];
};

export const ROLE_RULES = {
  /** Creating or deleting a site: Platform Admin only. */
  platformAdminOnly: { roles: [PLATFORM_ADMIN] },
  /** Catalog, reference data and price writes: Pharmacy Manager. */
  pharmacyManager: { roles: [PHARMACY_MANAGER] },
  /** Search synonym proposals, edits and deletes: Pharmacist and Pharmacy Manager. */
  searchSynonymEditor: { roles: [PHARMACIST, PHARMACY_MANAGER] },
  /** Approving a search synonym group: Pharmacist and Pharmacy Manager, never the person who proposed it. */
  searchSynonymApprover: { roles: [PHARMACIST, PHARMACY_MANAGER] },
} satisfies Record<string, RoleRule>;

/** True when one of the rule's roles is held. `readOnly` is a read request, which Platform Admin may always make. */
export const holdsRole = (roles: readonly string[], rule: RoleRule, readOnly = false): boolean =>
  (readOnly && roles.includes(PLATFORM_ADMIN)) || rule.roles.some((role) => roles.includes(role));

/** True when the approver is the person who created, proposed or last edited the record. A record with no recorded maker can be approved by anyone with the role. */
export const isSelfApproval = (approverId: string, makerId: string | null | undefined): boolean =>
  makerId !== null && makerId !== undefined && makerId === approverId;
