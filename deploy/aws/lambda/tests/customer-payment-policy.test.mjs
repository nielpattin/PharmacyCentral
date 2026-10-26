import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAuthorizerHandler } from "../authorizer.mjs";
import { decodeAndVerifyIdentityContext } from "../identity.mjs";
import { employeeRolesForRequest, isEmployeeRoute } from "../policy.mjs";

describe("customer payment authorization", () => {
  const invoicePath = "/api/payments/invoices/00000000-0000-4000-8000-0000000000aa";

  it("does not classify customer invoice creation as an employee route", () => {
    assert.equal(isEmployeeRoute("/api/payments/invoices", "POST"), false);
    assert.equal(employeeRolesForRequest("/api/payments/invoices", "POST"), undefined);
  });

  it("carves out only the single-invoice read for customers", () => {
    // Reading one's own invoice is how customer-web learns that a transfer landed; payment-service answers 404 for an
    // invoice that belongs to somebody else, so the edge only has to prove that a session exists.
    assert.equal(isEmployeeRoute(invoicePath, "GET"), false);
    // The invoice list, the printable invoice, every deeper path and every write stay behind the counter.
    assert.equal(isEmployeeRoute("/api/payments/invoices", "GET"), true);
    assert.equal(isEmployeeRoute("/api/payments/invoices/", "GET"), true);
    assert.equal(isEmployeeRoute(`${invoicePath}/invoice`, "GET"), true);
    assert.equal(isEmployeeRoute(`${invoicePath}/lines/1`, "GET"), true);
    assert.equal(isEmployeeRoute(invoicePath, "POST"), true);
    assert.equal(isEmployeeRoute(invoicePath, "DELETE"), true);
  });

  it("lets a manager read payments but keeps staff payment actions for pharmacists", () => {
    assert.equal(isEmployeeRoute("/api/payments/invoices", "GET"), true);
    assert.deepEqual(employeeRolesForRequest("/api/payments/invoices", "GET"), ["Pharmacist", "Pharmacy Manager"]);
    // A refund is a counter action for a Pharmacist and an online-order refund for a Pharmacy Manager: the edge admits
    // both, and payment-service decides by invoice kind.
    assert.deepEqual(employeeRolesForRequest("/api/payments/123/refund", "POST"), ["Pharmacist", "Pharmacy Manager"]);
    // A staff caller on the shared invoice read still has to satisfy the counter role.
    assert.deepEqual(employeeRolesForRequest(invoicePath, "GET"), ["Pharmacist", "Pharmacy Manager"]);
  });

  it("allows an authenticated customer to create an invoice with CSRF protection", async () => {
    const authorizer = createAuthorizerHandler({
      identityServiceUrl: "http://identity-service.local",
      internalIdentitySecret: "identity-secret",
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "customer-1", actorType: "customer", roles: [], siteIds: [] }),
      }),
      nowFn: () => new Date("2026-01-01T12:00:00.000Z"),
    });

    const result = await authorizer({
      rawPath: "/api/payments/invoices",
      headers: {
        cookie: "pharmacy_session=session; pharmacy_csrf=token",
        "x-csrf-token": "token",
      },
      requestContext: { http: { method: "POST", path: "/api/payments/invoices" } },
    });

    assert.equal(result.isAuthorized, true);
    assert.equal(result.context.actorType, "customer");
  });

  it("authorizes a customer reading their own invoice without demanding a counter role", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const secret = "customer-payment-identity-secret";
    const authorizerFor = (identity) =>
      createAuthorizerHandler({
        identityServiceUrl: "http://identity-service.local",
        internalIdentitySecret: secret,
        fetchFn: async () => ({ ok: true, status: 200, json: async () => identity }),
        nowFn: () => now,
      });
    const invoiceRead = {
      rawPath: invoicePath,
      headers: { cookie: "pharmacy_session=session" },
      requestContext: { http: { method: "GET", path: invoicePath } },
    };

    const customerResult = await authorizerFor({
      id: "customer-1",
      actorType: "customer",
      roles: [],
      siteIds: [],
    })(invoiceRead);

    assert.equal(customerResult.isAuthorized, true);
    assert.equal(customerResult.context.actorType, "customer");
    assert.equal(customerResult.context.actorId, "customer-1");
    const verified = decodeAndVerifyIdentityContext(
      customerResult.context.signedIdentityContext,
      secret,
      now,
    );
    assert.ok(verified);
    assert.equal(verified.actorType, "customer");
    assert.equal(verified.audience, "payment-service");

    // The shared read is a Pharmacist action, so a colleague without the counter role is refused.
    const warehouseResult = await authorizerFor({
      id: "employee-1",
      actorType: "employee",
      roles: ["Warehouse Staff"],
      siteIds: [],
    })(invoiceRead);
    assert.equal(warehouseResult.isAuthorized, false);
  });
});
