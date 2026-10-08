import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  catalogWritePrefixes,
  csrfExemptPrefixes,
  employeePrefixes,
  employeeRolesForRequest,
  isAuthRoute,
  isCatalogWriteRoute,
  isCsrfExempt,
  isCustomerPrescriptionRoute,
  isEmployeeRoleAllowed,
  isEmployeeRoute,
  isOptionalIdentityRoute,
  isPublicRoute,
  isSiteScopedListRoute,
  matchesPrefix,
  normalizeApiPath,
  optionalIdentityPrefixes,
  platformAdminPaths,
  publicPrefixes,
  selectTargetService,
  siteScopedListPrefixes,
} from "../policy.mjs";

describe("policy - path normalization and prefix matching", () => {
  it("normalizes paths to start with /api", () => {
    assert.equal(normalizeApiPath("/api/products"), "/api/products");
    assert.equal(normalizeApiPath("/products"), "/api/products");
    assert.equal(normalizeApiPath("/api/auth/login"), "/api/auth/login");
    assert.equal(normalizeApiPath("/auth/login"), "/api/auth/login");
    assert.equal(normalizeApiPath("/products?page=1"), "/api/products");
    assert.equal(normalizeApiPath(""), "/api/");
    assert.equal(normalizeApiPath("/"), "/api/");
  });

  it("matches prefixes accurately", () => {
    assert.equal(matchesPrefix("/api/products", "/api/products"), true);
    assert.equal(matchesPrefix("/api/products/123", "/api/products"), true);
    assert.equal(matchesPrefix("/products/123", "/api/products"), true);
    assert.equal(matchesPrefix("/api/products-other", "/api/products"), false);
  });
});

describe("policy - route classification", () => {
  it("identifies public routes", () => {
    assert.equal(isPublicRoute("/api/products"), true);
    assert.equal(isPublicRoute("/products"), true);
    assert.equal(isPublicRoute("/api/stores"), true);
    assert.equal(isPublicRoute("/api/pricing/active"), true);
    assert.equal(isPublicRoute("/api/availability"), true);
    assert.equal(isPublicRoute("/api/carts"), true);
    assert.equal(isPublicRoute("/api/delivery/calculate"), true);
    assert.equal(isPublicRoute("/api/delivery/reverse-geocode"), true);
    assert.equal(isPublicRoute("/api/delivery/addresses/search"), true);
    assert.equal(isPublicRoute("/api/delivery/addresses/resolve"), true);
    // Saved addresses belong to an account, so only the two lookups under that prefix are open.
    assert.equal(isPublicRoute("/api/delivery/addresses"), false);
    assert.equal(isPublicRoute("/api/delivery/addresses/123"), false);
    assert.equal(isPublicRoute("/api/auth/login"), true);
    assert.equal(isPublicRoute("/api/auth/register"), true);
    assert.equal(isPublicRoute("/api/auth/verify-email"), true);
    assert.equal(isPublicRoute("/api/auth/google"), true);
    assert.equal(isPublicRoute("/api/inventory/balances"), false);
    assert.equal(isPublicRoute("/api/orders"), false);
  });

  it("identifies optional identity routes", () => {
    assert.equal(isOptionalIdentityRoute("/api/carts"), true);
    assert.equal(isOptionalIdentityRoute("/carts"), true);
    assert.equal(isOptionalIdentityRoute("/api/carts/123/items"), true);
    assert.equal(isOptionalIdentityRoute("/api/delivery/calculate"), true);
    assert.equal(isOptionalIdentityRoute("/api/products"), false);
    assert.equal(isOptionalIdentityRoute("/api/orders"), false);
  });

  it("identifies catalog write routes", () => {
    assert.equal(isCatalogWriteRoute("/api/products", "POST"), true);
    assert.equal(isCatalogWriteRoute("/api/products/123", "PUT"), true);
    assert.equal(isCatalogWriteRoute("/api/products/123", "DELETE"), true);
    assert.equal(isCatalogWriteRoute("/api/products", "GET"), false);
    assert.equal(isCatalogWriteRoute("/api/products", "HEAD"), false);
    assert.equal(isCatalogWriteRoute("/api/products", "OPTIONS"), false);
    assert.equal(isCatalogWriteRoute("/api/sites", "POST"), true);
    assert.equal(isCatalogWriteRoute("/api/sites", "GET"), false);
    assert.equal(isCatalogWriteRoute("/api/storage-locations", "POST"), true);
    assert.equal(isCatalogWriteRoute("/api/suppliers", "POST"), true);
    assert.equal(isCatalogWriteRoute("/api/pricing/prices", "POST"), true);
  });

  it("identifies employee routes", () => {
    assert.equal(isEmployeeRoute("/api/procurement", "GET"), true);
    assert.equal(isEmployeeRoute("/api/inventory/balances", "GET"), true);
    assert.equal(isEmployeeRoute("/api/quality", "GET"), true);
    assert.equal(isEmployeeRoute("/api/operations", "GET"), true);
    assert.equal(isEmployeeRoute("/api/dashboard", "GET"), true);
    assert.equal(isEmployeeRoute("/api/finance", "GET"), true);
    assert.equal(isEmployeeRoute("/api/audit", "GET"), true);
    assert.equal(isEmployeeRoute("/api/reports", "GET"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions/123", "GET"), true);
    assert.equal(isEmployeeRoute("/api/counter-transactions", "GET"), true);
    assert.equal(isEmployeeRoute("/api/admin", "GET"), true);
    // Catalog writes are employee routes
    assert.equal(isEmployeeRoute("/api/products", "POST"), true);
    assert.equal(isEmployeeRoute("/api/products", "GET"), false);
  });

  // The prescription domain is split: a shopper may read their own history and upload their own prescription, and
  // every other request on the domain stays behind the counter.
  it("opens the shopper's own prescription requests to any signed-in account and keeps the rest staff-only", () => {
    assert.equal(isEmployeeRoute("/api/prescriptions/intake/qr", "POST"), false);
    assert.equal(isEmployeeRoute("/api/prescriptions/intake/image", "POST"), false);
    assert.equal(isEmployeeRoute("/prescriptions/intake/image", "POST"), false);
    assert.equal(isEmployeeRoute("/api/prescriptions/intake/image?limit=1", "POST"), false);
    // A sibling path only shares text with the prefix, not a path segment, so it stays an employee route.
    assert.equal(isEmployeeRoute("/api/prescriptions/intake-legacy", "POST"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions/intakeX", "POST"), true);
    // The list read is the customer-web Account page call, and sales-service forces the owner filter for it.
    assert.equal(isEmployeeRoute("/api/prescriptions", "GET"), false);
    assert.equal(isEmployeeRoute("/api/prescriptions?limit=50", "GET"), false);
    // Only the exact path is shared: a record read, a create and a dispense stay employee routes.
    assert.equal(isEmployeeRoute("/api/prescriptions/123", "GET"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions/", "GET"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions", "POST"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions/123/dispense", "POST"), true);
    assert.equal(isEmployeeRoute("/api/prescriptions/intake/qr", "GET"), true);
  });

  it("marks exactly the prescription requests a signed-in account may make", () => {
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions", "GET"), true);
    assert.equal(isCustomerPrescriptionRoute("/prescriptions?limit=50", "GET"), true);
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions/intake/qr", "POST"), true);
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions/intake/image", "POST"), true);

    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions/123", "GET"), false);
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions", "POST"), false);
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions/intake/qr", "GET"), false);
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions/intake-legacy", "POST"), false);
    assert.equal(isCustomerPrescriptionRoute("/api/counter-transactions", "POST"), false);
    // A prefix is not enough: the table entry for the list read names the whole path.
    assert.equal(isCustomerPrescriptionRoute("/api/prescriptions-archive", "GET"), false);
  });

  it("identifies site-scoped list routes", () => {
    assert.equal(isSiteScopedListRoute("/api/procurement/purchase-orders"), true);
    assert.equal(isSiteScopedListRoute("/api/procurement/goods-receipts"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/balances"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/movements"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/transfers"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/stocktakes"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/returns"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/replenishment"), true);
    assert.equal(isSiteScopedListRoute("/api/inventory/adjustments"), true);
    assert.equal(isSiteScopedListRoute("/api/dashboard/summary"), true);
    assert.equal(isSiteScopedListRoute("/api/finance/summary"), true);
    assert.equal(isSiteScopedListRoute("/api/reports"), true);
    assert.equal(isSiteScopedListRoute("/api/audit/logs"), true);
    assert.equal(isSiteScopedListRoute("/api/products"), false);
  });

  it("identifies auth routes", () => {
    assert.equal(isAuthRoute("/api/auth/login"), true);
    assert.equal(isAuthRoute("/auth/login"), true);
    assert.equal(isAuthRoute("/api/auth/csrf"), true);
    assert.equal(isAuthRoute("/api/auth/me"), true);
    assert.equal(isAuthRoute("/api/products"), false);
  });

  it("identifies CSRF exempt requests", () => {
    assert.equal(isCsrfExempt("/api/orders", "GET"), true);
    assert.equal(isCsrfExempt("/api/orders", "HEAD"), true);
    assert.equal(isCsrfExempt("/api/orders", "OPTIONS"), true);
    assert.equal(isCsrfExempt("/api/auth/login", "POST"), true);
    assert.equal(isCsrfExempt("/api/auth/register", "POST"), true);
    assert.equal(isCsrfExempt("/api/auth/setup-admin", "POST"), true);
    assert.equal(isCsrfExempt("/api/auth/verify-email", "POST"), true);
    assert.equal(isCsrfExempt("/api/auth/google", "POST"), true);
    assert.equal(isCsrfExempt("/api/payments/sepay/webhook", "POST"), true);
    assert.equal(isCsrfExempt("/api/orders", "POST"), false);
    assert.equal(isCsrfExempt("/api/products", "POST"), false);
    assert.equal(isCsrfExempt("/api/inventory/transfers", "POST"), false);
    // Intake is a shopper's POST, so it stays behind the double-submit check.
    assert.equal(isCsrfExempt("/api/prescriptions/intake/qr", "POST"), false);
    assert.equal(isCsrfExempt("/api/prescriptions/intake/image", "POST"), false);
    assert.equal(isCsrfExempt("/api/prescriptions/intake-legacy", "POST"), false);
  });
});

describe("policy - employee roles and authorization", () => {
  it("determines required roles for specific endpoints", () => {
    // Platform Admin
    assert.deepEqual(employeeRolesForRequest("/api/admin", "GET"), ["Platform Admin"]);
    assert.deepEqual(employeeRolesForRequest("/api/audit", "GET"), ["Platform Admin"]);

    // Management Only
    assert.deepEqual(employeeRolesForRequest("/api/finance", "GET"), ["Pharmacy Manager"]);

    // Replenishment
    assert.deepEqual(employeeRolesForRequest("/api/inventory/replenishment", "POST"), [
      "Pharmacist",
      "Warehouse Staff",
    ]);

    // Counter Sale
    // The list read is shared with shoppers, but staff keep the Pharmacist requirement because their call returns
    // every prescription rather than only the records of the account that asked.
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions", "GET"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions?limit=50", "GET"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/counter-transactions", "POST"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/payments", "POST"), ["Pharmacist"]);
    // Prescription intake is a shopper route, like customer invoice creation, so it carries no employee role.
    // The sibling paths that only share text with the intake paths keep the Pharmacist requirement.
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions/intake/qr", "POST"), undefined);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions/intake/image", "POST"), undefined);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions/intake-legacy", "POST"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions/intakeX", "POST"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions", "POST"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions/123/dispense", "POST"), ["Pharmacist"]);

    // Warehouse
    assert.deepEqual(employeeRolesForRequest("/api/procurement/goods-receipts", "GET"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/batches", "GET"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/movements", "GET"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/adjustments", "POST"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/transfers", "POST"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/stocktakes", "POST"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/inventory/returns", "POST"), ["Warehouse Staff"]);
    assert.deepEqual(employeeRolesForRequest("/api/quality", "GET"), ["Warehouse Staff"]);

    // Management paths (POST/PUT/DELETE requires Pharmacy Manager, GET does not)
    assert.deepEqual(employeeRolesForRequest("/api/products", "POST"), ["Pharmacy Manager"]);
    assert.deepEqual(employeeRolesForRequest("/api/products", "GET"), undefined);
    assert.deepEqual(employeeRolesForRequest("/api/procurement/purchase-orders", "POST"), ["Pharmacy Manager"]);
    assert.deepEqual(employeeRolesForRequest("/api/procurement/purchase-orders", "GET"), undefined);
  });

  it("checks if employee roles satisfy requirements", () => {
    assert.equal(isEmployeeRoleAllowed(["Platform Admin"], ["Warehouse Staff"]), true);
    assert.equal(isEmployeeRoleAllowed(["Platform Admin"], ["Pharmacy Manager"]), true);
    assert.equal(isEmployeeRoleAllowed(["Warehouse Staff"], ["Warehouse Staff"]), true);
    assert.equal(isEmployeeRoleAllowed(["Warehouse Staff"], ["Pharmacist", "Warehouse Staff"]), true);
    assert.equal(isEmployeeRoleAllowed(["Pharmacist"], ["Warehouse Staff"]), false);
    assert.equal(isEmployeeRoleAllowed([], ["Warehouse Staff"]), false);
    assert.equal(isEmployeeRoleAllowed(["Pharmacist"], undefined), true);
  });
});

describe("policy - target service selection", () => {
  it("maps paths to the correct backend service domain", () => {
    assert.equal(selectTargetService("/api/auth/login"), "identity-service");
    assert.equal(selectTargetService("/api/admin/users"), "identity-service");
    assert.equal(selectTargetService("/api/products"), "catalog-service");
    assert.equal(selectTargetService("/api/sites"), "catalog-service");
    assert.equal(selectTargetService("/api/pricing/prices"), "catalog-service");
    assert.equal(selectTargetService("/api/procurement/purchase-orders"), "inventory-service");
    assert.equal(selectTargetService("/api/inventory/balances"), "inventory-service");
    assert.equal(selectTargetService("/api/quality/inspections"), "inventory-service");
    assert.equal(selectTargetService("/api/carts"), "sales-service");
    assert.equal(selectTargetService("/api/orders"), "sales-service");
    assert.equal(selectTargetService("/api/delivery/calculate"), "sales-service");
    assert.equal(selectTargetService("/api/prescriptions"), "sales-service");
    assert.equal(selectTargetService("/api/payments"), "payment-service");
    assert.equal(selectTargetService("/api/operations/metrics"), "operations-query-service");
    assert.equal(selectTargetService("/api/dashboard/summary"), "operations-query-service");
    assert.equal(selectTargetService("/api/finance/summary"), "operations-query-service");
    assert.equal(selectTargetService("/api/audit/logs"), "operations-query-service");
    assert.equal(selectTargetService("/api/reports"), "operations-query-service");
    assert.equal(selectTargetService("/unknown"), "pharmacy-backend");
  });
});
