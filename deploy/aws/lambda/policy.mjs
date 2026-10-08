export const publicPrefixes = [
  "/api/auth/setup-status",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/verify-email",
  "/api/auth/google",
  "/api/products",
  "/api/stores",
  "/api/sites",
  "/api/pricing/active",
  "/api/availability",
  "/api/carts",
  "/api/delivery/calculate",
  "/api/delivery/reverse-geocode",
  "/api/delivery/addresses/search",
  "/api/delivery/addresses/resolve",
  "/api/payments/sepay/webhook",
];

export const optionalIdentityPrefixes = ["/api/carts", "/api/delivery/calculate"];

export const employeePrefixes = [
  "/api/procurement",
  "/api/inventory",
  "/api/quality",
  "/api/operations",
  "/api/dashboard",
  "/api/finance",
  "/api/audit",
  "/api/reports",
  "/api/prescriptions",
  "/api/counter-transactions",
  "/api/admin",
];

export const catalogWritePrefixes = [
  "/api/sites",
  "/api/storage-locations",
  "/api/suppliers",
  "/api/products",
  "/api/pricing/prices",
];

export const siteScopedListPrefixes = [
  "/api/procurement/purchase-orders",
  "/api/procurement/goods-receipts",
  "/api/inventory/balances",
  "/api/inventory/movements",
  "/api/inventory/transfers",
  "/api/inventory/stocktakes",
  "/api/inventory/returns",
  "/api/inventory/replenishment",
  "/api/inventory/adjustments",
  "/api/dashboard/summary",
  "/api/finance/summary",
  "/api/reports",
  "/api/audit/logs",
];

export const managementPaths = [
  "/api/sites",
  "/api/storage-locations",
  "/api/suppliers",
  "/api/products",
  "/api/pricing/prices",
  "/api/procurement/purchase-orders",
];

export const warehousePaths = [
  "/api/procurement/goods-receipts",
  "/api/inventory/batches",
  "/api/inventory/movements",
  "/api/inventory/adjustments",
  "/api/inventory/transfers",
  "/api/inventory/stocktakes",
  "/api/inventory/stocktake-lines",
  "/api/inventory/returns",
  "/api/quality",
];

export const replenishmentPaths = ["/api/inventory/replenishment"];
export const counterSalePaths = ["/api/prescriptions", "/api/counter-transactions"];
// Prescription requests that any signed-in account may make, because part of this domain belongs to the shopper:
// intake uploads a shopper's own prescription, and the list read returns only the records linked to the caller's
// own account once sales-service has forced the owner filter for a non-staff actor. Every path is listed in full
// and matched either exactly or by path segment, so a path that merely shares text ("/api/prescriptions/intake-legacy"
// for the intake prefix, "/api/prescriptions/123" for the list read) stays a staff route. keepsStaffRole records
// whether a staff caller still has to satisfy the role counterSalePaths demands: reading the whole prescription
// register is a Pharmacist action, while uploading one's own is not.
export const customerPrescriptionRequests = [
  { method: "GET", path: "/api/prescriptions", match: "exact", keepsStaffRole: true },
  { method: "POST", path: "/api/prescriptions/intake/qr", match: "segment", keepsStaffRole: false },
  { method: "POST", path: "/api/prescriptions/intake/image", match: "segment", keepsStaffRole: false },
];
export const platformAdminPaths = ["/api/admin", "/api/audit"];
export const managementOnlyPaths = ["/api/finance"];

export const csrfExemptPrefixes = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/setup-admin",
  "/api/auth/verify-email",
  "/api/auth/google",
  "/api/payments/sepay/webhook",
];

export const normalizeApiPath = (path = "/") => {
  let p = path.split("?")[0].trim();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p === "/api" || p.startsWith("/api/")) return p;
  return `/api${p}`;
};

export const matchesPrefix = (path, prefix) => {
  const normPath = normalizeApiPath(path);
  const normPrefix = normalizeApiPath(prefix);
  return normPath === normPrefix || normPath.startsWith(`${normPrefix}/`);
};

export const isPublicRoute = (path) => {
  const norm = normalizeApiPath(path);
  return publicPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

export const isOptionalIdentityRoute = (path) => {
  const norm = normalizeApiPath(path);
  return optionalIdentityPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

export const isCatalogWriteRoute = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
  const upperMethod = method.toUpperCase();
  if (upperMethod === "GET" || upperMethod === "HEAD" || upperMethod === "OPTIONS") return false;
  return catalogWritePrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

const isCustomerInvoiceCreationRoute = (path, method = "GET") =>
  method.toUpperCase() === "POST" && matchesPrefix(path, "/api/payments/invoices");

const matchesCustomerPrescriptionRequest = (request, path, method) => {
  if (request.method !== method.toUpperCase()) return false;
  const norm = normalizeApiPath(path);
  return request.match === "exact" ? norm === request.path : matchesPrefix(norm, request.path);
};

// True when any signed-in account may make the request. That is a weaker bar than an employee route but not a
// public one: the caller still has to present a session, because the authorizer resolves identity for every route
// that is neither public nor an auth route.
export const isCustomerPrescriptionRoute = (path, method = "GET") =>
  customerPrescriptionRequests.some((request) => matchesCustomerPrescriptionRequest(request, path, method));

// Requests nobody behind the counter has a role for. A shared path such as the list read keeps its staff role.
const isCustomerOnlyPrescriptionRoute = (path, method = "GET") =>
  customerPrescriptionRequests.some(
    (request) => !request.keepsStaffRole && matchesCustomerPrescriptionRequest(request, path, method),
  );

export const isEmployeeRoute = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
  // These routes belong to the shopper: the route itself refuses a request without an actor, so the authorizer only
  // has to prove that a session exists, not that the account works behind the counter. A staff caller on a path both
  // audiences share still keeps the role that employeeRolesForRequest demands for it.
  if (isCustomerPrescriptionRoute(norm, method)) return false;
  const paymentEmployeeRoute =
    matchesPrefix(norm, "/api/payments") &&
    !matchesPrefix(norm, "/api/payments/sepay/webhook") &&
    !isCustomerInvoiceCreationRoute(norm, method);
  return (
    employeePrefixes.some((prefix) => matchesPrefix(norm, prefix)) ||
    isCatalogWriteRoute(norm, method) ||
    paymentEmployeeRoute
  );
};

export const isSiteScopedListRoute = (path) => {
  const norm = normalizeApiPath(path);
  return siteScopedListPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

export const isAuthRoute = (path) => {
  const norm = normalizeApiPath(path);
  return matchesPrefix(norm, "/api/auth");
};

export const isCsrfExempt = (path, method = "GET") => {
  const upperMethod = method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(upperMethod)) return true;
  const norm = normalizeApiPath(path);
  return csrfExemptPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

export const employeeRolesForRequest = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
  const upperMethod = method.toUpperCase();

  if (platformAdminPaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Platform Admin"];
  if (managementOnlyPaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Pharmacy Manager"];
  if (replenishmentPaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Pharmacist", "Warehouse Staff"];
  if (
    counterSalePaths.some((prefix) => matchesPrefix(norm, prefix)) &&
    !isCustomerOnlyPrescriptionRoute(norm, upperMethod)
  )
    return ["Pharmacist"];
  if (
    matchesPrefix(norm, "/api/payments") &&
    !matchesPrefix(norm, "/api/payments/sepay/webhook") &&
    !isCustomerInvoiceCreationRoute(norm, upperMethod)
  ) {
    return ["Pharmacist"];
  }
  if (warehousePaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Warehouse Staff"];
  if (
    managementPaths.some((prefix) => matchesPrefix(norm, prefix)) &&
    upperMethod !== "GET" &&
    upperMethod !== "HEAD"
  ) {
    return ["Pharmacy Manager"];
  }
  return undefined;
};

export const isEmployeeRoleAllowed = (roles = [], requiredRoles) => {
  if (!requiredRoles || requiredRoles.length === 0) return true;
  if (roles.includes("Platform Admin")) return true;
  return requiredRoles.some((role) => roles.includes(role));
};

export const selectTargetService = (path) => {
  const norm = normalizeApiPath(path);
  if (matchesPrefix(norm, "/api/auth") || matchesPrefix(norm, "/api/admin")) return "identity-service";
  if (
    [
      "/api/sites",
      "/api/storage-locations",
      "/api/products",
      "/api/suppliers",
      "/api/pricing",
      "/api/stores",
      "/api/availability",
    ].some((prefix) => matchesPrefix(norm, prefix))
  ) {
    return "catalog-service";
  }
  if (matchesPrefix(norm, "/api/procurement")) return "inventory-service";
  if (["/api/inventory", "/api/quality"].some((prefix) => matchesPrefix(norm, prefix))) {
    return "inventory-service";
  }
  if (
    ["/api/carts", "/api/orders", "/api/delivery", "/api/prescriptions", "/api/counter-transactions"].some((prefix) =>
      matchesPrefix(norm, prefix),
    )
  ) {
    return "sales-service";
  }
  if (matchesPrefix(norm, "/api/payments")) return "payment-service";
  if (
    ["/api/operations", "/api/dashboard", "/api/finance", "/api/audit", "/api/reports"].some((prefix) =>
      matchesPrefix(norm, prefix),
    )
  ) {
    return "operations-query-service";
  }
  return "pharmacy-backend";
};
