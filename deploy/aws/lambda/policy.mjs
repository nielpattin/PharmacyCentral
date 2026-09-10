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

export const isEmployeeRoute = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
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
  if (counterSalePaths.some((prefix) => matchesPrefix(norm, prefix))) return ["Pharmacist"];
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
