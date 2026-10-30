import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAuthorizerHandler } from "../authorizer.mjs";
import { employeeRolesForRequest, isEmployeeRoleAllowed } from "../policy.mjs";

// The role contract of docs/product/staff-shell-sign-in-and-navigation.md (Role-by-section access), read per method.
// Each row is [who, method, path, allowed]. Platform Admin reads every staff route and writes only where a rule names it.
const PA = ["Platform Admin"];
const PM = ["Pharmacy Manager"];
const PH = ["Pharmacist"];
const WS = ["Warehouse Staff"];

const SITE = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

const matrix = [
  // Dashboard and reporting
  ["dashboard PM", PM, "GET", "/api/dashboard/summary", true],
  ["dashboard WS", WS, "GET", "/api/dashboard", true],
  ["dashboard PH refused", PH, "GET", "/api/dashboard", false],
  ["analytics PM", PM, "GET", "/api/dashboard/analytics", true],
  ["analytics PA", PA, "GET", "/api/dashboard/analytics", true],
  ["analytics WS refused", WS, "GET", "/api/dashboard/analytics", false],
  ["analytics PH refused", PH, "GET", "/api/dashboard/analytics", false],
  ["operations dashboard WS", WS, "GET", "/api/operations/dashboard", true],
  ["operations dashboard PH refused", PH, "GET", "/api/operations/dashboard", false],
  ["reports PM", PM, "GET", "/api/reports", true],
  ["reports WS refused", WS, "GET", "/api/reports", false],
  ["reports PH refused", PH, "GET", "/api/reports", false],
  ["finance PM", PM, "GET", "/api/finance/summary", true],
  ["finance WS refused", WS, "GET", "/api/finance/summary", false],
  ["operations finance PH refused", PH, "GET", "/api/operations/finance", false],
  ["audit PA", PA, "GET", "/api/audit/logs", true],
  ["audit PM refused", PM, "GET", "/api/audit/logs", false],
  ["operations audit PM refused", PM, "GET", "/api/operations/audit", false],

  // Master data
  ["sites read WS", WS, "GET", "/api/sites", true],
  ["sites read by id PH", PH, "GET", "/api/sites/11111111-1111-4111-8111-111111111111", true],
  ["sites create PM refused", PM, "POST", "/api/sites", false],
  ["sites create PA", PA, "POST", "/api/sites", true],
  ["sites edit PA refused", PA, "PUT", "/api/sites/11111111-1111-4111-8111-111111111111", false],
  ["sites edit PM", PM, "PUT", "/api/sites/11111111-1111-4111-8111-111111111111", true],
  ["sites delete PM refused", PM, "DELETE", "/api/sites/11111111-1111-4111-8111-111111111111", false],
  ["sites delete PA", PA, "DELETE", "/api/sites/11111111-1111-4111-8111-111111111111", true],
  ["storage locations read WS", WS, "GET", "/api/storage-locations", true],
  ["storage locations write PM", PM, "POST", "/api/storage-locations", true],
  ["storage locations write WS refused", WS, "POST", "/api/storage-locations", false],
  ["suppliers write PH refused", PH, "POST", "/api/suppliers", false],
  ["products write PM", PM, "POST", "/api/products", true],
  ["products write PH refused", PH, "POST", "/api/products", false],
  ["pricing prices read WS (all statuses)", WS, "GET", "/api/pricing/prices", true],
  ["pricing prices write PM", PM, "POST", "/api/pricing/prices", true],
  ["pricing prices write WS refused", WS, "POST", "/api/pricing/prices", false],

  // Search synonyms: Pharmacist and Pharmacy Manager propose and approve; Platform Admin reads only.
  ["synonyms read PH", PH, "GET", "/api/products/search-synonyms", true],
  ["synonyms read WS refused", WS, "GET", "/api/products/search-synonyms", false],
  ["synonyms propose PH", PH, "POST", "/api/products/search-synonyms", true],
  ["synonyms propose PA refused", PA, "POST", "/api/products/search-synonyms", false],
  ["synonyms read PA", PA, "GET", "/api/products/search-synonyms", true],
  ["synonyms approve PH", PH, "POST", "/api/products/search-synonyms/33333333-3333-4333-8333-333333333333/approve", true],
  ["synonyms approve PM", PM, "POST", "/api/products/search-synonyms/33333333-3333-4333-8333-333333333333/approve", true],
  ["synonyms approve PA refused", PA, "POST", "/api/products/search-synonyms/33333333-3333-4333-8333-333333333333/approve", false],

  // Online orders: staff read and move the orders at their sites.
  ["orders list PH", PH, "GET", "/api/orders", true],
  ["orders list WS refused", WS, "GET", "/api/orders", false],
  ["order detail PM", PM, "GET", "/api/orders/33333333-3333-4333-8333-333333333333", true],
  ["order transition PH", PH, "POST", "/api/orders/33333333-3333-4333-8333-333333333333/transition", true],
  ["order transition WS refused", WS, "POST", "/api/orders/33333333-3333-4333-8333-333333333333/transition", false],
  ["order transition PA refused", PA, "POST", "/api/orders/33333333-3333-4333-8333-333333333333/transition", false],
  ["orders read PA", PA, "GET", "/api/orders", true],

  // Counter: Pharmacist writes; Pharmacy Manager and Platform Admin read.
  ["prescriptions read PH", PH, "GET", "/api/prescriptions", true],
  ["prescriptions read PM", PM, "GET", "/api/prescriptions?limit=50", true],
  ["prescriptions read WS refused", WS, "GET", "/api/prescriptions", false],
  ["prescriptions read PA", PA, "GET", "/api/prescriptions", true],
  ["prescriptions create PH", PH, "POST", "/api/prescriptions", true],
  ["prescriptions create PM refused", PM, "POST", "/api/prescriptions", false],
  ["prescriptions create PA refused", PA, "POST", "/api/prescriptions", false],
  ["prescriptions cancel PH", PH, "POST", "/api/prescriptions/33333333-3333-4333-8333-333333333333/cancel", true],
  ["prescriptions cancel PA refused", PA, "POST", "/api/prescriptions/33333333-3333-4333-8333-333333333333/cancel", false],
  ["prescriptions dispense PH", PH, "POST", "/api/prescriptions/33333333-3333-4333-8333-333333333333/dispense", true],
  ["prescriptions dispense PA refused", PA, "POST", "/api/prescriptions/33333333-3333-4333-8333-333333333333/dispense", false],
  ["consultation answer PH", PH, "POST", "/api/prescriptions/consultations/33333333-3333-4333-8333-333333333333/answer", true],
  ["consultation answer PA refused", PA, "POST", "/api/prescriptions/consultations/33333333-3333-4333-8333-333333333333/answer", false],
  ["consultation register PM", PM, "GET", "/api/prescriptions/consultations", true],
  ["counter transactions read PM", PM, "GET", "/api/counter-transactions", true],
  ["counter transactions write PM refused", PM, "POST", "/api/counter-transactions", false],
  ["counter transactions write PA refused", PA, "POST", "/api/counter-transactions", false],

  // Payments: a refund is open to Pharmacist and Pharmacy Manager at the edge (payment-service decides by invoice
  // kind); cash and counter confirmation are Pharmacist actions. Platform Admin reads the register only.
  ["refund PH", PH, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/refund", true],
  ["refund PM", PM, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/refund", true],
  ["refund PA refused", PA, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/refund", false],
  ["refund WS refused", WS, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/refund", false],
  ["confirm-counter PH", PH, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", true],
  ["confirm-counter PA refused", PA, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", false],
  ["confirm-counter PH", PH, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", true],
  ["confirm-counter PM refused", PM, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", false],
  ["confirm-counter PA refused", PA, "POST", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", false],
  ["counter invoice create PA refused", PA, "POST", "/api/payments/prescriptions/33333333-3333-4333-8333-333333333333", false],
  ["counter invoice create PH", PH, "POST", "/api/payments/prescriptions/33333333-3333-4333-8333-333333333333", true],
  ["invoice register PM", PM, "GET", "/api/payments/invoices", true],
  ["invoice register WS refused", WS, "GET", "/api/payments/invoices", false],

  // Procurement and receiving
  ["purchase orders read PM", PM, "GET", "/api/procurement/purchase-orders", true],
  ["purchase orders read WS", WS, "GET", "/api/procurement/purchase-orders", true],
  ["purchase orders read PH refused", PH, "GET", "/api/procurement/purchase-orders", false],
  ["purchase orders create WS refused", WS, "POST", "/api/procurement/purchase-orders", false],
  ["purchase orders create PM", PM, "POST", "/api/procurement/purchase-orders", true],
  ["purchase orders action PM", PM, "POST", "/api/procurement/purchase-orders/33333333-3333-4333-8333-333333333333/action", true],
  ["goods receipts read WS", WS, "GET", "/api/procurement/goods-receipts", true],
  ["goods receipts read PM refused", PM, "GET", "/api/procurement/goods-receipts", false],
  ["replenishment suggestions read PM", PM, "GET", "/api/procurement/replenishment-suggestions", true],
  ["replenishment suggestions read PA", PA, "GET", "/api/procurement/replenishment-suggestions", true],
  ["replenishment suggestions read PH refused", PH, "GET", "/api/procurement/replenishment-suggestions", false],
  ["replenishment suggestions read WS refused", WS, "GET", "/api/procurement/replenishment-suggestions", false],
  ["replenishment draft orders create PM", PM, "POST", "/api/procurement/replenishment-suggestions/draft-orders", true],
  ["replenishment draft orders create PA refused", PA, "POST", "/api/procurement/replenishment-suggestions/draft-orders", false],
  ["replenishment draft orders create PH refused", PH, "POST", "/api/procurement/replenishment-suggestions/draft-orders", false],
  ["replenishment draft orders create WS refused", WS, "POST", "/api/procurement/replenishment-suggestions/draft-orders", false],

  // Stock
  ["opening balances import WS", WS, "POST", "/api/inventory/imports/opening-balances", true],
  ["opening balances import PM refused", PM, "POST", "/api/inventory/imports/opening-balances", false],
  ["opening balances import PH refused", PH, "POST", "/api/inventory/imports/opening-balances", false],
  ["opening balances import PA refused", PA, "POST", "/api/inventory/imports/opening-balances", false],
  ["balances read PH", PH, "GET", "/api/inventory/balances", true],
  ["batches read PH", PH, "GET", "/api/inventory/batches", true],
  ["batches read PM", PM, "GET", "/api/inventory/batches", true],
  ["batches read WS", WS, "GET", "/api/inventory/batches", true],
  ["batch create PH refused", PH, "POST", "/api/inventory/batches", false],
  ["batch create WS", WS, "POST", "/api/inventory/batches", true],
  ["batch quality PH", PH, "POST", "/api/inventory/batches/33333333-3333-4333-8333-333333333333/quality", true],
  ["batch quality PM", PM, "POST", "/api/inventory/batches/33333333-3333-4333-8333-333333333333/quality", true],
  ["batch quality WS refused", WS, "POST", "/api/inventory/batches/33333333-3333-4333-8333-333333333333/quality", false],
  ["movements read PM", PM, "GET", "/api/inventory/movements", true],
  ["movements read PH refused", PH, "GET", "/api/inventory/movements", false],
  ["movement record WS", WS, "POST", "/api/inventory/movements", true],
  ["movement record PM refused", PM, "POST", "/api/inventory/movements", false],
  ["adjustments read PM", PM, "GET", "/api/inventory/adjustments", true],
  ["adjustment propose WS", WS, "POST", "/api/inventory/adjustments", true],
  ["adjustment propose PM refused", PM, "POST", "/api/inventory/adjustments", false],
  ["adjustment approve PM", PM, "POST", "/api/inventory/adjustments/33333333-3333-4333-8333-333333333333/approve", true],
  ["adjustment approve WS refused", WS, "POST", "/api/inventory/adjustments/33333333-3333-4333-8333-333333333333/approve", false],
  ["transfers read PM", PM, "GET", "/api/inventory/transfers", true],
  ["transfer create WS", WS, "POST", "/api/inventory/transfers", true],
  ["transfer create PM refused", PM, "POST", "/api/inventory/transfers", false],
  ["transfer approve PM", PM, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/approve", true],
  ["transfer approve WS refused", WS, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/approve", false],
  ["transfer ship WS", WS, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/ship", true],
  ["transfer ship PM refused", PM, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/ship", false],
  ["transfer cancel PM", PM, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/cancel", true],
  ["transfer cancel WS", WS, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/cancel", true],
  ["transfer cancel PH refused", PH, "POST", "/api/inventory/transfers/33333333-3333-4333-8333-333333333333/cancel", false],
  ["stocktake create WS", WS, "POST", "/api/inventory/stocktakes", true],
  ["stocktake count WS", WS, "POST", "/api/inventory/stocktake-lines/33333333-3333-4333-8333-333333333333/count", true],
  ["stocktake count PM refused", PM, "POST", "/api/inventory/stocktake-lines/33333333-3333-4333-8333-333333333333/count", false],
  ["stocktake post PM", PM, "POST", "/api/inventory/stocktakes/33333333-3333-4333-8333-333333333333/post", true],
  ["stocktake post WS refused", WS, "POST", "/api/inventory/stocktakes/33333333-3333-4333-8333-333333333333/post", false],
  ["returns read PM", PM, "GET", "/api/inventory/returns", true],
  ["return create WS", WS, "POST", "/api/inventory/returns", true],
  ["return approve PM", PM, "POST", "/api/inventory/returns/33333333-3333-4333-8333-333333333333/approve", true],
  ["return approve WS refused", WS, "POST", "/api/inventory/returns/33333333-3333-4333-8333-333333333333/approve", false],
  ["replenishment create PH", PH, "POST", "/api/inventory/replenishment", true],
  ["replenishment create PM", PM, "POST", "/api/inventory/replenishment", true],
  ["replenishment create WS refused", WS, "POST", "/api/inventory/replenishment", false],
  ["replenishment read PH", PH, "GET", "/api/inventory/replenishment", true],
  ["replenishment read WS", WS, "GET", "/api/inventory/replenishment", true],
  ["replenishment cancel PH", PH, "POST", "/api/inventory/replenishment/33333333-3333-4333-8333-333333333333/cancel", true],
  ["replenishment cancel WS", WS, "POST", "/api/inventory/replenishment/33333333-3333-4333-8333-333333333333/cancel", true],
  ["replenishment approve WS", WS, "POST", "/api/inventory/replenishment/33333333-3333-4333-8333-333333333333/approve", true],
  ["replenishment approve PH refused", PH, "POST", "/api/inventory/replenishment/33333333-3333-4333-8333-333333333333/approve", false],
  ["replenishment fulfil PH refused", PH, "POST", "/api/inventory/replenishment/33333333-3333-4333-8333-333333333333/fulfill", false],
  // Action plans (design 0007): only a Pharmacy Manager creates; every staff role reads and moves one. The owner check
  // of a move belongs to the service, so the edge admits each staff role on the path.
  ["action plan create PM", PM, "POST", "/api/inventory/action-plans", true],
  ["action plan create PA refused", PA, "POST", "/api/inventory/action-plans", false],
  ["action plan reassign PA", PA, "PATCH", "/api/inventory/action-plans/33333333-3333-4333-8333-333333333333", true],
  ["action plan create PH refused", PH, "POST", "/api/inventory/action-plans", false],
  ["action plan create WS refused", WS, "POST", "/api/inventory/action-plans", false],
  ["action plan read PH", PH, "GET", "/api/inventory/action-plans", true],
  ["action plan read WS", WS, "GET", "/api/inventory/action-plans", true],
  ["action plan move PH", PH, "PATCH", "/api/inventory/action-plans/33333333-3333-4333-8333-333333333333", true],
  ["action plan move WS", WS, "PATCH", "/api/inventory/action-plans/33333333-3333-4333-8333-333333333333", true],
  ["action plan move PM", PM, "PATCH", "/api/inventory/action-plans/33333333-3333-4333-8333-333333333333", true],
];

describe("role matrix - each rule per role and method", () => {
  for (const [who, roles, method, path, allowed] of matrix) {
    it(`${who}: ${method} ${path} is ${allowed ? "allowed" : "refused"}`, () => {
      const required = employeeRolesForRequest(path, method);
      assert.equal(isEmployeeRoleAllowed(roles, required, path, method), allowed);
    });
  }

  it("keeps Platform Admin read-only on every staff route and open on the paths no staff rule covers", () => {
    const allowed = (method, path) => isEmployeeRoleAllowed(PA, employeeRolesForRequest(path, method), path, method);
    assert.equal(allowed("GET", "/api/inventory/balances"), true);
    assert.equal(allowed("GET", "/api/procurement/purchase-orders"), true);
    assert.equal(allowed("POST", "/api/inventory/adjustments"), false);
    assert.equal(allowed("PUT", "/api/products/33333333-3333-4333-8333-333333333333"), false);
    assert.equal(allowed("POST", "/api/products/imports"), false);
    assert.equal(allowed("POST", "/api/admin/users"), true);
    assert.equal(allowed("PUT", "/api/ai/anything-else"), true, "a path no staff route covers is not gated");
    assert.equal(allowed("POST", "/api/auth/logout"), true);
    assert.equal(allowed("POST", "/api/prescriptions/intake/qr"), true, "a shopper's upload is not a counter write");
    assert.equal(allowed("POST", "/api/inventory/unknown-write"), false, "a staff route with no rule refuses a Platform Admin write");
  });

  it("lets an account that holds Platform Admin and another role use the other role", () => {
    const roles = ["Platform Admin", "Pharmacy Manager"];
    const path = "/api/procurement/purchase-orders";
    assert.equal(isEmployeeRoleAllowed(roles, employeeRolesForRequest(path, "POST"), path, "POST"), true);
  });
});

// Authorizer level: the same gates through the Lambda handler, with a fake identity service.
const identityServiceUrl = "http://identity-service.local";
const testSecret = "super-secret-internal-identity-key";
const fixedNow = new Date("2026-01-01T12:00:00.000Z");

const accounts = {
  "session-warehouse": { id: "00000000-0000-4000-8000-000000000012", actorType: "employee", roles: WS, siteIds: [SITE] },
  "session-pharmacist": { id: "00000000-0000-4000-8000-000000000013", actorType: "employee", roles: PH, siteIds: [SITE] },
  "session-admin": { id: "00000000-0000-4000-8000-000000000015", actorType: "employee", roles: PA, siteIds: [] },
  "session-new-admin": {
    id: "00000000-0000-4000-8000-000000000016",
    actorType: "employee",
    roles: PA,
    siteIds: [],
    passwordChangeRequired: true,
  },
};

const fetchFor = async (url, options) => {
  const match = /(?:^|;\s*)pharmacy_session=([^;]+)/.exec(options?.headers?.cookie ?? "");
  const identity = match && accounts[match[1]];
  if (!url.endsWith("/auth/me") || !identity) return { ok: false, status: 401 };
  return { ok: true, status: 200, json: async () => identity };
};

const authorizer = createAuthorizerHandler({
  identityServiceUrl,
  internalIdentitySecret: testSecret,
  fetchFn: fetchFor,
  nowFn: () => fixedNow,
});

const mutating = (session, rawPath, method) => ({
  rawPath,
  headers: { cookie: `pharmacy_session=${session}; pharmacy_csrf=token-1`, "x-csrf-token": "token-1" },
  requestContext: { http: { method, path: rawPath } },
});

describe("authorizer - role matrix, exclusions, published prices and password change", () => {
  it("refuses Platform Admin confirming cash at the counter", async () => {
    const result = await authorizer(
      mutating("session-admin", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", "POST"),
    );
    assert.equal(result.isAuthorized, false);
  });

  it("allows a Pharmacist to confirm cash at the counter", async () => {
    const result = await authorizer(
      mutating("session-pharmacist", "/api/payments/33333333-3333-4333-8333-333333333333/confirm-counter", "POST"),
    );
    assert.equal(result.isAuthorized, true);
  });

  it("allows Platform Admin to read the counter list and refuses its counter write", async () => {
    const read = await authorizer({
      rawPath: "/api/prescriptions",
      headers: { cookie: "pharmacy_session=session-admin" },
      requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
    });
    assert.equal(read.isAuthorized, true);
    const write = await authorizer(mutating("session-admin", "/api/prescriptions", "POST"));
    assert.equal(write.isAuthorized, false);
  });

  it("admits Warehouse Staff to the dashboard and refuses them the reports", async () => {
    const dashboard = await authorizer({
      rawPath: "/api/dashboard/summary",
      headers: { cookie: "pharmacy_session=session-warehouse" },
      requestContext: { http: { method: "GET", path: "/api/dashboard/summary" } },
    });
    assert.equal(dashboard.isAuthorized, true, "the dashboard admits Warehouse Staff");
    const reports = await authorizer({
      rawPath: "/api/reports",
      headers: { cookie: "pharmacy_session=session-warehouse" },
      requestContext: { http: { method: "GET", path: "/api/reports" } },
    });
    assert.equal(reports.isAuthorized, false);
  });

  it("lets anyone read the published price list without a session, and no other price read", async () => {
    const published = await authorizer({
      rawPath: "/api/pricing/prices",
      queryStringParameters: { status: "Published", limit: "500" },
      requestContext: { http: { method: "GET", path: "/api/pricing/prices" } },
    });
    assert.equal(published.isAuthorized, true);
    assert.equal(published.context.actorType, "anonymous");

    const draft = await authorizer({
      rawPath: "/api/pricing/prices",
      queryStringParameters: { status: "Draft" },
      requestContext: { http: { method: "GET", path: "/api/pricing/prices" } },
    });
    assert.equal(draft.isAuthorized, false);
  });

  it("refuses an anonymous request for sites, storage locations and suppliers", async () => {
    for (const path of ["/api/sites", "/api/storage-locations", "/api/suppliers"]) {
      const result = await authorizer({
        rawPath: path,
        requestContext: { http: { method: "GET", path } },
      });
      assert.equal(result.isAuthorized, false, path);
    }
  });

  it("refuses every route to an account that must change its password, except the auth routes", async () => {
    const admin = await authorizer({
      rawPath: "/api/admin/users",
      headers: { cookie: "pharmacy_session=session-new-admin" },
      requestContext: { http: { method: "GET", path: "/api/admin/users" } },
    });
    assert.equal(admin.isAuthorized, false);

    const me = await authorizer({
      rawPath: "/api/auth/me",
      headers: { cookie: "pharmacy_session=session-new-admin" },
      requestContext: { http: { method: "GET", path: "/api/auth/me" } },
    });
    assert.equal(me.isAuthorized, true, "auth routes do not resolve the account, so the gate does not apply");

    for (const [method, path] of [
      ["POST", "/api/auth/change-password"],
      ["POST", "/api/auth/logout"],
    ]) {
      const result = await authorizer(mutating("session-new-admin", path, method));
      assert.equal(result.isAuthorized, true, `${method} ${path} stays open to finish the password change`);
    }
  });
});
