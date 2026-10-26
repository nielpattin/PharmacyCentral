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
  "/api/delivery/calculate",
  "/api/delivery/reverse-geocode",
  "/api/delivery/addresses/search",
  "/api/delivery/addresses/resolve",
  "/api/payments/sepay/webhook",
];

export const optionalIdentityPrefixes = ["/api/delivery/calculate"];

export const aiCredentialPaths = [
  "/api/chatbot/credential",
  "/api/chatbot/intent-gate-credential",
  "/api/prescriptions/intake-credential",
  "/api/products/search-credential",
];

export const employeePrefixes = [
  "/api/system",
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
  "/api/customers",
  ...aiCredentialPaths,
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
// intake uploads a shopper's own prescription, a consultation sends the whole read prescription to the pharmacists
// and the list reads return only the records linked to the caller's own account once sales-service has forced the
// owner filter for a non-staff actor. Every path is listed in full and matched either exactly or by path segment, so
// a path that merely shares text ("/api/prescriptions/intake-legacy" for the intake prefix, "/api/prescriptions/123"
// for the list read, "/api/prescriptions/consultations/<id>/answer" for the consultation paths) stays a staff route.
// keepsStaffRole records whether a staff caller still has to satisfy the role counterSalePaths demands: reading the
// whole prescription register, consultations included, is a Pharmacist action, while uploading or sending one's own
// is not.
export const customerPrescriptionRequests = [
  { method: "GET", path: "/api/prescriptions", match: "exact", keepsStaffRole: true },
  { method: "GET", path: "/api/prescriptions/consultations", match: "exact", keepsStaffRole: true },
  { method: "POST", path: "/api/prescriptions/consultations", match: "exact", keepsStaffRole: false },
  { method: "POST", path: "/api/prescriptions/intake/qr", match: "segment", keepsStaffRole: false },
  { method: "POST", path: "/api/prescriptions/intake/image", match: "segment", keepsStaffRole: false },
];
// Payment requests that any signed-in account may make, because part of this domain belongs to the shopper: creating
// an invoice is how a shopper asks to pay for a counter order, and reading one's own invoice is how customer-web
// learns that the transfer landed, while payment-service answers 404 for an invoice that belongs to somebody else.
// The read is matched one segment below the invoice list, so the list read itself, the printable invoice
// ("/api/payments/invoices/<id>/invoice") and every deeper path stay staff routes.
// keepsStaffRole records whether a staff caller still has to satisfy the role the payments prefix demands: reading
// the invoice register is a counter action a Pharmacy Manager may also perform, while creating one's own invoice is
// not.
export const customerPaymentRequests = [
  { method: "POST", path: "/api/payments/invoices", match: "exact", keepsStaffRole: false },
  { method: "GET", path: "/api/payments/invoices", match: "child", keepsStaffRole: true },
];
export const platformAdminPaths = ["/api/admin", "/api/audit", "/api/system", ...aiCredentialPaths];
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

const matchesCustomerRequest = (request, path, method) => {
  if (request.method !== method.toUpperCase()) return false;
  const norm = normalizeApiPath(path);
  if (request.match === "exact") return norm === request.path;
  if (request.match === "child") {
    const prefix = `${normalizeApiPath(request.path)}/`;
    if (!norm.startsWith(prefix)) return false;
    const remainder = norm.slice(prefix.length);
    return remainder.length > 0 && !remainder.includes("/");
  }
  return matchesPrefix(norm, request.path);
};

// True when any signed-in account may make the request. That is a weaker bar than an employee route but not a
// public one: the caller still has to present a session, because the authorizer resolves identity for every route
// that is neither public nor an auth route.
export const isCustomerPrescriptionRoute = (path, method = "GET") =>
  customerPrescriptionRequests.some((request) => matchesCustomerRequest(request, path, method));

export const isCustomerPaymentRoute = (path, method = "GET") =>
  customerPaymentRequests.some((request) => matchesCustomerRequest(request, path, method));

// The entries nobody behind the counter has a role for. A shared path such as the invoice read keeps its staff role,
// so it is not listed here and a staff caller on it still has to satisfy the role its domain demands.
const customerOnlyPrescriptionRequests = customerPrescriptionRequests.filter((request) => !request.keepsStaffRole);
const customerOnlyPaymentRequests = customerPaymentRequests.filter((request) => !request.keepsStaffRole);

export const isEmployeeRoute = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
  // These routes belong to the shopper: the route itself refuses a request without an actor (payment-service answers
  // 404 for an invoice that is not the caller's), so the authorizer only has to prove that a session exists, not that
  // the account works behind the counter. A staff caller on a path both audiences share still keeps the role that
  // employeeRolesForRequest demands for it.
  if (isCustomerPrescriptionRoute(norm, method) || isCustomerPaymentRoute(norm, method)) return false;
  const paymentEmployeeRoute =
    matchesPrefix(norm, "/api/payments") && !matchesPrefix(norm, "/api/payments/sepay/webhook");
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
  // Linking a prescription to a customer account is part of the counter, so the lookup carries the Pharmacist role.
  if (matchesPrefix(norm, "/api/customers")) return ["Pharmacist"];
  if (managementOnlyPaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Pharmacy Manager"];
  if (replenishmentPaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Pharmacist", "Warehouse Staff"];
  // Dispensing, taking payment and answering consultations need a licensed pharmacist. A Pharmacy Manager supervises
  // the counter, so they may read the same prescriptions, transactions, invoices and consultations, never change them.
  const counterRoles =
    upperMethod === "GET" || upperMethod === "HEAD" ? ["Pharmacist", "Pharmacy Manager"] : ["Pharmacist"];
  if (
    counterSalePaths.some((prefix) => matchesPrefix(norm, prefix)) &&
    !customerOnlyPrescriptionRequests.some((request) => matchesCustomerRequest(request, norm, upperMethod))
  )
    return counterRoles;
  if (
    matchesPrefix(norm, "/api/payments") &&
    !matchesPrefix(norm, "/api/payments/sepay/webhook") &&
    !customerOnlyPaymentRequests.some((request) => matchesCustomerRequest(request, norm, upperMethod))
  ) {
    return counterRoles;
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
  if (["/api/auth", "/api/admin", "/api/customers"].some((prefix) => matchesPrefix(norm, prefix))) {
    return "identity-service";
  }
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
  if (matchesPrefix(norm, "/api/chatbot")) return "chatbot-service";
  if (matchesPrefix(norm, "/api/system")) return "ops-console-service";
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
