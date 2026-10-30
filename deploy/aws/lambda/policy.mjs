const PLATFORM_ADMIN = "Platform Admin";
const PHARMACY_MANAGER = "Pharmacy Manager";
const PHARMACIST = "Pharmacist";
const WAREHOUSE_STAFF = "Warehouse Staff";

export const publicPrefixes = [
  "/api/auth/setup-status",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/verify-email",
  "/api/auth/google",
  "/api/products",
  "/api/stores",
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

// Staff-only reads and writes. Sites, storage locations and suppliers are reference data a shopper never reads;
// synonyms and the payment and counter surfaces are listed here so that a shopper session is refused on them.
export const employeePrefixes = [
  "/api/system",
  "/api/procurement",
  "/api/inventory",
  "/api/operations",
  "/api/dashboard",
  "/api/finance",
  "/api/audit",
  "/api/reports",
  "/api/prescriptions",
  "/api/counter-transactions",
  "/api/sales-targets",
  "/api/admin",
  "/api/customers",
  "/api/sites",
  "/api/storage-locations",
  "/api/suppliers",
  "/api/products/search-synonyms",
  "/api/pricing/prices",
  ...aiCredentialPaths,
];

export const catalogWritePrefixes = [
  "/api/sites",
  "/api/storage-locations",
  "/api/suppliers",
  "/api/products",
  "/api/pricing/prices",
];

// Lists that a site-scoped employee reads only at their assigned sites. A shopper's own orders are not site-limited,
// so `/api/orders` is listed for the staff reads; the edge applies the list only to staff callers.
export const siteScopedListPrefixes = [
  "/api/procurement/purchase-orders",
  "/api/procurement/goods-receipts",
  "/api/procurement/replenishment-suggestions",
  "/api/inventory/balances",
  "/api/inventory/batches",
  "/api/inventory/movements",
  "/api/inventory/transfers",
  "/api/inventory/transfer-suggestions",
  "/api/inventory/stocktakes",
  "/api/inventory/returns",
  "/api/inventory/replenishment",
  "/api/inventory/action-plans",
  "/api/inventory/adjustments",
  "/api/dashboard/summary",
  "/api/dashboard/analytics",
  "/api/operations/dashboard",
  "/api/finance/summary",
  "/api/operations/finance",
  "/api/reports",
  "/api/audit/logs",
  "/api/operations/audit",
  "/api/orders",
];

export const platformAdminPaths = ["/api/admin", "/api/audit", "/api/system", ...aiCredentialPaths];

export const csrfExemptPrefixes = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/setup-admin",
  "/api/auth/verify-email",
  "/api/auth/google",
  "/api/payments/sepay/webhook",
];

// Requests a shopper may make on a path the staff roles below would otherwise gate. The prescription entries mirror the
// shopper's own intake, consultation and read; the payment entries let a shopper create an invoice and read their own.
// Every path is listed in full and matched exactly, by one segment, or by path segment, so a sibling path that only
// shares text with one of these ("/api/prescriptions/intake-legacy", "/api/prescriptions/123") stays a staff route.
// keepsStaffRole records whether a staff caller still has to satisfy the role the path demands: reading the whole
// prescription register is a counter action, while uploading or sending one's own is not.
export const customerPrescriptionRequests = [
  { method: "GET", path: "/api/prescriptions", match: "exact", keepsStaffRole: true },
  { method: "GET", path: "/api/prescriptions/consultations", match: "exact", keepsStaffRole: true },
  { method: "POST", path: "/api/prescriptions/consultations", match: "exact", keepsStaffRole: false },
  { method: "POST", path: "/api/prescriptions/intake/qr", match: "segment", keepsStaffRole: false },
  { method: "POST", path: "/api/prescriptions/intake/image", match: "segment", keepsStaffRole: false },
];
// The read is matched one segment below the invoice list, so the list read itself, the printable invoice
// ("/api/payments/invoices/<id>/invoice") and every deeper path stay staff routes.
export const customerPaymentRequests = [
  { method: "POST", path: "/api/payments/invoices", match: "exact", keepsStaffRole: false },
  { method: "GET", path: "/api/payments/invoices", match: "child", keepsStaffRole: true },
];

// Each rule names the roles that may make a request on a path. `methods` is "*" (every method), "READ" (GET and HEAD),
// "WRITE" (every other method), or one or more method names. `match` is "exact" (the same segments), "prefix" (the
// path or anything below it) or "child" (one segment below). A `*` segment matches any one non-empty segment, so
// "/api/inventory/batches/*/quality" names one batch's quality route. The first matching rule decides, so a specific
// rule is listed before the general one that covers it. Platform Admin reads everything, but writes only where a rule
// names it: users, roles and site access, audit, AI credentials, the System page, creating and deleting sites, and
// reassigning an action plan. Every other write belongs to a Pharmacist, Pharmacy Manager or Warehouse Staff.
export const employeeRoleRules = [
  // Platform Admin only.
  ...platformAdminPaths.map((path) => ({ methods: "*", path, match: "prefix", roles: [PLATFORM_ADMIN] })),
  { methods: "*", path: "/api/operations/audit", match: "prefix", roles: [PLATFORM_ADMIN] },
  { methods: "*", path: "/api/customers", match: "prefix", roles: [PHARMACIST] },
  { methods: "*", path: "/api/finance", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "*", path: "/api/operations/finance", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "*", path: "/api/reports", match: "prefix", roles: [PHARMACY_MANAGER] },
  // Period analytics (design 0007): a Pharmacy Manager reads it; Platform Admin reads every route.
  { methods: "*", path: "/api/dashboard/analytics", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "*", path: "/api/dashboard/sales-targets", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "*", path: "/api/dashboard", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  { methods: "*", path: "/api/operations/dashboard", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },

  // Sites: only Platform Admin creates or deletes one; a Pharmacy Manager edits the sites assigned to them.
  { methods: ["POST"], path: "/api/sites", match: "exact", roles: [PLATFORM_ADMIN] },
  { methods: ["DELETE"], path: "/api/sites/*", match: "exact", roles: [PLATFORM_ADMIN] },

  // Search synonyms: a Pharmacist or Pharmacy Manager proposes, edits, approves and deletes; Platform Admin reads.
  { methods: "*", path: "/api/products/search-synonyms", match: "prefix", roles: [PHARMACIST, PHARMACY_MANAGER] },

  // Online orders: staff read the orders at their sites and move them. A shopper's own list, detail, creation and
  // withdrawal are not staff roles: the shopper is not an employee, so the role check does not apply to them.
  { methods: "READ", path: "/api/orders", match: "prefix", roles: [PHARMACIST, PHARMACY_MANAGER] },
  { methods: "*", path: "/api/orders/*/transition", match: "exact", roles: [PHARMACIST, PHARMACY_MANAGER] },
  // Sales targets: a Pharmacy Manager sets a site's monthly goal; Platform Admin reads the report but writes nothing.
  { methods: "*", path: "/api/sales-targets", match: "prefix", roles: [PHARMACY_MANAGER] },

  // Counter: the Pharmacist dispenses, takes payment and answers consultations. A Pharmacy Manager supervises and may
  // read the same records, never change them. Platform Admin reads them too.
  { methods: "READ", path: "/api/prescriptions", match: "prefix", roles: [PHARMACIST, PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/prescriptions", match: "prefix", roles: [PHARMACIST] },
  { methods: "READ", path: "/api/counter-transactions", match: "prefix", roles: [PHARMACIST, PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/counter-transactions", match: "prefix", roles: [PHARMACIST] },

  // Payments. A refund is the one counter write a Pharmacy Manager may also make: payment-service decides by invoice
  // kind (counter invoice: Pharmacist; online order: Pharmacy Manager).
  { methods: ["POST"], path: "/api/payments/*/refund", match: "exact", roles: [PHARMACIST, PHARMACY_MANAGER] },
  { methods: "READ", path: "/api/payments", match: "prefix", roles: [PHARMACIST, PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/payments", match: "prefix", roles: [PHARMACIST] },

  // Replenishment suggestions and the draft orders made from them (design 0007): a Pharmacy Manager reads and drafts;
  // Platform Admin reads. These rules come before the procurement rules so that no other rule can answer for them.
  {
    methods: "READ",
    path: "/api/procurement/replenishment-suggestions",
    match: "prefix",
    roles: [PHARMACY_MANAGER],
  },
  {
    methods: "WRITE",
    path: "/api/procurement/replenishment-suggestions",
    match: "prefix",
    roles: [PHARMACY_MANAGER],
  },

  // Procurement and receiving.
  {
    methods: "READ",
    path: "/api/procurement/purchase-orders",
    match: "prefix",
    roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: "WRITE", path: "/api/procurement/purchase-orders", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "*", path: "/api/procurement/goods-receipts", match: "prefix", roles: [WAREHOUSE_STAFF] },

  // Catalog master data: a Pharmacy Manager writes it; reads are open to every signed-in employee.
  { methods: "WRITE", path: "/api/sites", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/storage-locations", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/suppliers", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/products", match: "prefix", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/pricing/prices", match: "prefix", roles: [PHARMACY_MANAGER] },

  // Stock. Balances have no rule: every signed-in employee reads them at their sites.
  { methods: "*", path: "/api/inventory/imports/opening-balances", match: "exact", roles: [WAREHOUSE_STAFF] },
  // Replenishment: a Pharmacist or Pharmacy Manager requests and cancels their own; Warehouse Staff approve, reject and
  // fulfil, and may cancel. The requester never approves, which the owning service checks.
  {
    methods: "READ",
    path: "/api/inventory/replenishment",
    match: "prefix",
    roles: [PHARMACIST, PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: ["POST"], path: "/api/inventory/replenishment", match: "exact", roles: [PHARMACIST, PHARMACY_MANAGER] },
  {
    methods: ["POST"],
    path: "/api/inventory/replenishment/*/cancel",
    match: "exact",
    roles: [PHARMACIST, PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: "WRITE", path: "/api/inventory/replenishment", match: "prefix", roles: [WAREHOUSE_STAFF] },
  // Action plans (design 0007): plans are created automatically; the owner, a manager or Warehouse Staff reads and moves
  // one. Platform Admin and a Pharmacy Manager may reassign it, never move its status. The owning service decides which
  // plans a caller sees and which fields a caller may change.
  {
    methods: "READ",
    path: "/api/inventory/action-plans",
    match: "prefix",
    roles: [PHARMACIST, PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: ["POST"], path: "/api/inventory/action-plans", match: "exact", roles: [PHARMACY_MANAGER] },
  {
    methods: ["PATCH"],
    path: "/api/inventory/action-plans/*",
    match: "exact",
    roles: [PLATFORM_ADMIN, PHARMACIST, PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  {
    methods: "READ",
    path: "/api/inventory/batches",
    match: "prefix",
    roles: [PHARMACIST, PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  {
    methods: ["POST"],
    path: "/api/inventory/batches/*/quality",
    match: "exact",
    roles: [PHARMACIST, PHARMACY_MANAGER],
  },
  { methods: "WRITE", path: "/api/inventory/batches", match: "prefix", roles: [WAREHOUSE_STAFF] },
  { methods: "READ", path: "/api/inventory/movements", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  { methods: "WRITE", path: "/api/inventory/movements", match: "prefix", roles: [WAREHOUSE_STAFF] },
  { methods: "READ", path: "/api/inventory/adjustments", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  { methods: ["POST"], path: "/api/inventory/adjustments/*/*", match: "exact", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/inventory/adjustments", match: "prefix", roles: [WAREHOUSE_STAFF] },
  // Transfers: Warehouse Staff create, ship and receive; a Pharmacy Manager approves, never the creator; the creator or a
  // Pharmacy Manager cancels. Stocktakes: Warehouse Staff count; a Pharmacy Manager posts, never the counter.
  // Returns and removals: Warehouse Staff create; a Pharmacy Manager approves or rejects.
  { methods: "READ", path: "/api/inventory/transfers", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  {
    methods: "READ",
    path: "/api/inventory/transfer-suggestions",
    match: "exact",
    roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: ["POST"], path: "/api/inventory/transfers/*/approve", match: "exact", roles: [PHARMACY_MANAGER] },
  {
    methods: ["POST"],
    path: "/api/inventory/transfers/*/cancel",
    match: "exact",
    roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF],
  },
  { methods: "WRITE", path: "/api/inventory/transfers", match: "prefix", roles: [WAREHOUSE_STAFF] },
  { methods: "READ", path: "/api/inventory/stocktakes", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  { methods: ["POST"], path: "/api/inventory/stocktakes/*/post", match: "exact", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/inventory/stocktakes", match: "prefix", roles: [WAREHOUSE_STAFF] },
  { methods: "WRITE", path: "/api/inventory/stocktake-lines", match: "prefix", roles: [WAREHOUSE_STAFF] },
  { methods: "READ", path: "/api/inventory/returns", match: "prefix", roles: [PHARMACY_MANAGER, WAREHOUSE_STAFF] },
  { methods: ["POST"], path: "/api/inventory/returns/*/*", match: "exact", roles: [PHARMACY_MANAGER] },
  { methods: "WRITE", path: "/api/inventory/returns", match: "prefix", roles: [WAREHOUSE_STAFF] },
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

const methodMatches = (methods, upperMethod) => {
  const list = Array.isArray(methods) ? methods : [methods];
  return list.some((candidate) => {
    if (candidate === "*") return true;
    if (candidate === "READ") return upperMethod === "GET" || upperMethod === "HEAD";
    if (candidate === "WRITE") return upperMethod !== "GET" && upperMethod !== "HEAD";
    return candidate === upperMethod;
  });
};

const pathMatchesPattern = (path, pattern, match = "prefix") => {
  const actual = normalizeApiPath(path).split("/");
  const expected = pattern.split("/");
  if (match === "exact" && actual.length !== expected.length) return false;
  if (match === "child" && actual.length !== expected.length + 1) return false;
  if (match !== "exact" && actual.length < expected.length) return false;
  return expected.every((segment, index) =>
    segment === "*" ? actual[index] !== undefined && actual[index] !== "" : actual[index] === segment,
  );
};

export const isPublicRoute = (path) => {
  const norm = normalizeApiPath(path);
  return publicPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

export const isOptionalIdentityRoute = (path) => {
  const norm = normalizeApiPath(path);
  return optionalIdentityPrefixes.some((prefix) => matchesPrefix(norm, prefix));
};

/**
 * A price list read by a shopper: `GET /api/pricing/prices?status=Published` is open to anyone, because it shows the
 * prices customer-web displays. Any other price read (Draft, Archived, all statuses) is a staff read.
 */
export const isPublishedPriceRead = (path, method = "GET", query = {}) =>
  method.toUpperCase() === "GET" &&
  ["/api/pricing/prices", "/api/pricing/prices/count"].includes(normalizeApiPath(path)) &&
  query?.status === "Published";

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
const customerOnlyRequests = [...customerPrescriptionRequests, ...customerPaymentRequests].filter(
  (request) => !request.keepsStaffRole,
);

const isCustomerOnlyRequest = (path, method) =>
  customerOnlyRequests.some((request) => matchesCustomerRequest(request, path, method));

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

/** The roles an employee needs for the request, or undefined when any signed-in employee may make it. */
export const employeeRolesForRequest = (path, method = "GET") => {
  const norm = normalizeApiPath(path);
  const upperMethod = method.toUpperCase();
  if (matchesPrefix(norm, "/api/payments/sepay/webhook")) return undefined;
  if (isCustomerOnlyRequest(norm, upperMethod)) return undefined;
  const rule = employeeRoleRules.find(
    (candidate) =>
      methodMatches(candidate.methods, upperMethod) && pathMatchesPattern(norm, candidate.path, candidate.match),
  );
  return rule?.roles;
};

const isReadMethod = (method) => ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/**
 * Whether an employee with `roles` may make the request. A role the rule names passes. Otherwise a request with no role
 * rule passes for any employee, and a rule that does not name the employee's role refuses it. Platform Admin keeps the
 * console read-only: it reads every staff route, but writes only on a rule that names it, or on a path no staff route
 * covers (sign-out, password change, the shopper surface). A staff route with no role rule refuses its write too.
 * Without `path`, that last check is skipped.
 */
export const isEmployeeRoleAllowed = (roles = [], requiredRoles, path, method = "GET") => {
  const hasRule = Array.isArray(requiredRoles) && requiredRoles.length > 0;
  if (hasRule && requiredRoles.some((role) => roles.includes(role))) return true;
  if (!roles.includes(PLATFORM_ADMIN)) return !hasRule;
  if (isReadMethod(method)) return true;
  if (hasRule) return false;
  return path === undefined || !isEmployeeRoute(path, method);
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
  if (matchesPrefix(norm, "/api/inventory")) return "inventory-service";
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
