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
    assert.equal(isEmployeeRoute("/api/prescriptions", "GET"), true);
    assert.equal(isEmployeeRoute("/api/counter-transactions", "GET"), true);
    assert.equal(isEmployeeRoute("/api/admin", "GET"), true);
    // Catalog writes are employee routes
    assert.equal(isEmployeeRoute("/api/products", "POST"), true);
    assert.equal(isEmployeeRoute("/api/products", "GET"), false);
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
    assert.deepEqual(employeeRolesForRequest("/api/prescriptions", "GET"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/counter-transactions", "POST"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/payments", "POST"), ["Pharmacist"]);

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
