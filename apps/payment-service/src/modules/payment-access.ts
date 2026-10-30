import type { Request } from "express";

/**
 * Who may take and reverse money, restated here for the local stack (see `deploy/aws/lambda/policy.mjs`). The edge
 * admits the roles; this module decides what the edge cannot see, the kind of invoice. Platform Admin reads the money
 * records and moves none.
 */

export type AccessRefusal = {
  status: 403;
  title: string;
  code: "role_forbidden";
  detail: string;
};

export type SiteRefusal = {
  status: 403;
  title: string;
  code: "site_access_denied";
  detail: string;
};

/** The roles the trusted layer copied from the verified identity context; empty when no verified employee calls. */
export const actorRoles = (request: Request): string[] =>
  (request.header("x-actor-roles") ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);

/**
 * The actor headers a service-to-service read forwards so sales-service judges the same caller. The identity context is
 * audience-bound to this service, so the verified values travel as plain headers beside the internal service secret.
 */
export const forwardedActorHeaders = (request: Request): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  for (const name of ["x-actor-type", "x-actor-roles", "x-actor-site-ids"]) {
    const value = request.header(name);
    if (value !== undefined) forwarded[name] = value;
  }
  return forwarded;
};

const roleForbidden = (detail: string): AccessRefusal => ({
  status: 403,
  title: "Role not allowed",
  code: "role_forbidden",
  detail,
});

/** A counter invoice for a prescription is created by a Pharmacist; every other role is refused. */
export const counterInvoiceRefusal = (roles: readonly string[]): AccessRefusal | undefined =>
  roles.includes("Pharmacist") ? undefined : roleForbidden("Chỉ Dược sĩ được lập hóa đơn cho đơn thuốc tại quầy.");

/**
 * Refuses a record whose site lies outside the caller's sites. `allowedSiteIds` is undefined when the caller has no
 * site limit (Platform Admin, internal services), so only a site-scoped employee can be refused here.
 */
export const siteScopeRefusal = (
  siteId: string,
  allowedSiteIds: readonly string[] | undefined,
): SiteRefusal | undefined =>
  allowedSiteIds === undefined || allowedSiteIds.includes(siteId)
    ? undefined
    : {
        status: 403,
        title: "Site access denied",
        code: "site_access_denied",
        detail: "Bản ghi thuộc nhà thuốc bạn không được phân quyền.",
      };

/** Cash confirmation (`confirm-counter`) is a Pharmacist act; no other role satisfies it. */
export const cashConfirmationRefusal = (roles: readonly string[]): AccessRefusal | undefined =>
  roles.includes("Pharmacist") ? undefined : roleForbidden("Chỉ Dược sĩ được xác nhận tiền mặt.");

/**
 * Refund depends on the invoice kind. An invoice of an online order is refunded by a Pharmacy Manager. A counter
 * invoice (no order) is refunded by a Pharmacist. Platform Admin refunds neither.
 */
export const refundRefusal = (
  invoice: { orderId: string | null },
  roles: readonly string[],
): AccessRefusal | undefined => {
  if (invoice.orderId) {
    return roles.includes("Pharmacy Manager")
      ? undefined
      : roleForbidden("Chỉ Quản lý dược được hoàn tiền đơn hàng online.");
  }
  return roles.includes("Pharmacist") ? undefined : roleForbidden("Chỉ Dược sĩ được hoàn tiền hóa đơn tại quầy.");
};
