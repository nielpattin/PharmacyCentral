import type { Request } from "express";

/**
 * Who may take and reverse money. The trusted-request middleware admits the roles; this module decides what the
 * middleware cannot see, the kind of invoice. Platform Admin reads the money records and moves none.
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

/** The roles the trusted layer copied from the verified access token; empty when no verified employee calls. */
export const actorRoles = (request: Request): string[] =>
  (request.header("x-actor-roles") ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);

/** The caller's own access token, which a read made on the caller's behalf forwards so the other service judges the same caller. */
export const forwardedAuthorization = (request: Request): Record<string, string> => {
  const authorization = request.header("authorization");
  return authorization === undefined ? {} : { authorization };
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
