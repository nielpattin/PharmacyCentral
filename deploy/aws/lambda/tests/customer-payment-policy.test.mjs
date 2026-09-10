import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAuthorizerHandler } from "../authorizer.mjs";
import { employeeRolesForRequest, isEmployeeRoute } from "../policy.mjs";

describe("customer payment authorization", () => {
  it("does not classify customer invoice creation as an employee route", () => {
    assert.equal(isEmployeeRoute("/api/payments/invoices", "POST"), false);
    assert.equal(employeeRolesForRequest("/api/payments/invoices", "POST"), undefined);
  });

  it("keeps payment reads and staff actions restricted to pharmacists", () => {
    assert.equal(isEmployeeRoute("/api/payments/invoices", "GET"), true);
    assert.deepEqual(employeeRolesForRequest("/api/payments/invoices", "GET"), ["Pharmacist"]);
    assert.deepEqual(employeeRolesForRequest("/api/payments/123/refund", "POST"), ["Pharmacist"]);
  });

  it("allows an authenticated customer to create an invoice with CSRF protection", async () => {
    const authorizer = createAuthorizerHandler({
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
});
