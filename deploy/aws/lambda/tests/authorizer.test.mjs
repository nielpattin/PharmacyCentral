import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createAuthorizerHandler } from "../authorizer.mjs";
import { decodeAndVerifyIdentityContext } from "../identity.mjs";

describe("authorizer - API Gateway HTTP API v2 request authorizer", () => {
  const testSecret = "super-secret-internal-identity-key";
  const fixedNow = new Date("2026-01-01T12:00:00.000Z");

  const mockCustomer = {
    id: "00000000-0000-4000-8000-000000000001",
    actorType: "customer",
    roles: [],
    siteIds: [],
  };

  const mockWarehouseEmployee = {
    id: "00000000-0000-4000-8000-000000000002",
    actorType: "employee",
    roles: ["Warehouse Staff"],
    siteIds: ["11111111-1111-4111-8111-111111111111"],
  };

  const mockPharmacist = {
    id: "00000000-0000-4000-8000-000000000003",
    actorType: "employee",
    roles: ["Pharmacist"],
    siteIds: ["11111111-1111-4111-8111-111111111111"],
  };

  const mockManager = {
    id: "00000000-0000-4000-8000-000000000004",
    actorType: "employee",
    roles: ["Pharmacy Manager"],
    siteIds: ["11111111-1111-4111-8111-111111111111"],
  };

  const mockAdmin = {
    id: "00000000-0000-4000-8000-000000000005",
    actorType: "employee",
    roles: ["Platform Admin"],
    siteIds: [],
  };

  const createMockFetch = (sessionMap = {}) => {
    return async (url, options) => {
      const cookie = options?.headers?.cookie || "";
      const match = /(?:^|;\s*)pharmacy_session=([^;]+)/.exec(cookie);
      const sessionId = match?.[1];

      if (url.endsWith("/auth/me")) {
        if (sessionId && sessionMap[sessionId]) {
          const user = sessionMap[sessionId];
          if (user === "error") {
            return { ok: false, status: 500 };
          }
          return {
            ok: true,
            status: 200,
            json: async () => user,
          };
        }
        return { ok: false, status: 401 };
      }
      return { ok: false, status: 404 };
    };
  };

  const sessionMap = {
    "session-customer": mockCustomer,
    "session-warehouse": mockWarehouseEmployee,
    "session-pharmacist": mockPharmacist,
    "session-manager": mockManager,
    "session-admin": mockAdmin,
    "session-error": "error",
  };

  const authorizer = createAuthorizerHandler({
    internalIdentitySecret: testSecret,
    internalServiceSecret: "service-secret",
    fetchFn: createMockFetch(sessionMap),
    nowFn: () => fixedNow,
  });

  describe("public and auth routes", () => {
    it("authorizes public catalog queries without session", async () => {
      const event = {
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "system");
      assert.equal(result.context.actorId, "");

      const verified = decodeAndVerifyIdentityContext(result.context.signedIdentityContext, testSecret, fixedNow);
      assert.ok(verified);
      assert.equal(verified.actorType, "system");
      assert.equal(verified.audience, "catalog-service");
    });

    it("authorizes auth login and register endpoints without session", async () => {
      const event = {
        rawPath: "/api/auth/login",
        requestContext: { http: { method: "POST", path: "/api/auth/login" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "system");
    });
  });

  describe("optional identity routes", () => {
    it("allows unauthenticated guest carts", async () => {
      const event = {
        rawPath: "/api/carts",
        requestContext: { http: { method: "GET", path: "/api/carts" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "system");
      assert.equal(result.context.actorId, "");
    });

    it("resolves customer identity on carts when session cookie is provided", async () => {
      const event = {
        rawPath: "/api/carts",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/carts" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "customer");
      assert.equal(result.context.actorId, mockCustomer.id);
    });

    it("falls back to guest identity when optional session returns 401", async () => {
      const event = {
        rawPath: "/api/carts",
        headers: { cookie: "pharmacy_session=invalid-session" },
        requestContext: { http: { method: "GET", path: "/api/carts" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "system");
    });

    it("fails when identity-service is down on optional route with cookie", async () => {
      const event = {
        rawPath: "/api/carts",
        headers: { cookie: "pharmacy_session=session-error" },
        requestContext: { http: { method: "GET", path: "/api/carts" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });
  });

  describe("protected customer routes", () => {
    it("denies access to /api/orders without session", async () => {
      const event = {
        rawPath: "/api/orders",
        requestContext: { http: { method: "GET", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("allows authenticated customer access to /api/orders", async () => {
      const event = {
        rawPath: "/api/orders",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "customer");
      assert.equal(result.context.actorId, mockCustomer.id);
    });
  });

  describe("CSRF double-submit validation on mutating requests", () => {
    it("denies POST /api/orders when CSRF cookie and header are missing", async () => {
      const event = {
        rawPath: "/api/orders",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "POST", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("denies POST /api/orders when CSRF token mismatches", async () => {
      const event = {
        rawPath: "/api/orders",
        headers: {
          cookie: "pharmacy_session=session-customer; pharmacy_csrf=token-a",
          "x-csrf-token": "token-b",
        },
        requestContext: { http: { method: "POST", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("authorizes POST /api/orders when CSRF token matches", async () => {
      const event = {
        rawPath: "/api/orders",
        headers: {
          cookie: "pharmacy_session=session-customer; pharmacy_csrf=valid-token-123",
          "x-csrf-token": "valid-token-123",
        },
        requestContext: { http: { method: "POST", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "customer");
    });

    it("allows CSRF exempt endpoints without CSRF token", async () => {
      const sepayEvent = {
        rawPath: "/api/payments/sepay/webhook",
        requestContext: { http: { method: "POST", path: "/api/payments/sepay/webhook" } },
      };

      const result = await authorizer(sepayEvent);
      assert.equal(result.isAuthorized, true);
    });
  });

  describe("employee route authorization and role policy", () => {
    it("denies customer attempting to access warehouse route", async () => {
      const event = {
        rawPath: "/api/inventory/batches",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/inventory/batches" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("allows warehouse staff to access warehouse route", async () => {
      const event = {
        rawPath: "/api/inventory/batches",
        headers: { cookie: "pharmacy_session=session-warehouse" },
        requestContext: { http: { method: "GET", path: "/api/inventory/batches" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "employee");
      assert.equal(result.context.actorId, mockWarehouseEmployee.id);
    });

    it("denies pharmacist from accessing warehouse-only route", async () => {
      const event = {
        rawPath: "/api/inventory/batches",
        headers: { cookie: "pharmacy_session=session-pharmacist" },
        requestContext: { http: { method: "GET", path: "/api/inventory/batches" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("allows pharmacist to access counter transaction and replenishment", async () => {
      const event = {
        rawPath: "/api/prescriptions",
        headers: { cookie: "pharmacy_session=session-pharmacist" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
    });

    it("requires Pharmacy Manager for catalog writes", async () => {
      const managerEvent = {
        rawPath: "/api/products",
        headers: {
          cookie: "pharmacy_session=session-manager; pharmacy_csrf=token",
          "x-csrf-token": "token",
        },
        requestContext: { http: { method: "POST", path: "/api/products" } },
      };
      assert.equal((await authorizer(managerEvent)).isAuthorized, true);

      const warehouseEvent = {
        rawPath: "/api/products",
        headers: {
          cookie: "pharmacy_session=session-warehouse; pharmacy_csrf=token",
          "x-csrf-token": "token",
        },
        requestContext: { http: { method: "POST", path: "/api/products" } },
      };
      assert.equal((await authorizer(warehouseEvent)).isAuthorized, false);
    });

    it("allows Platform Admin for all employee endpoints", async () => {
      const adminEvent = {
        rawPath: "/api/admin/users",
        headers: { cookie: "pharmacy_session=session-admin" },
        requestContext: { http: { method: "GET", path: "/api/admin/users" } },
      };
      assert.equal((await authorizer(adminEvent)).isAuthorized, true);

      const warehouseRouteForAdmin = {
        rawPath: "/api/inventory/batches",
        headers: { cookie: "pharmacy_session=session-admin" },
        requestContext: { http: { method: "GET", path: "/api/inventory/batches" } },
      };
      assert.equal((await authorizer(warehouseRouteForAdmin)).isAuthorized, true);
    });

    it("denies non-Platform Admin for /api/admin", async () => {
      const managerEvent = {
        rawPath: "/api/admin/users",
        headers: { cookie: "pharmacy_session=session-manager" },
        requestContext: { http: { method: "GET", path: "/api/admin/users" } },
      };
      assert.equal((await authorizer(managerEvent)).isAuthorized, false);
    });
  });

  describe("prescription domain authorization", () => {
    it("allows a signed-in customer to post prescription intake QR and image", async () => {
      for (const path of ["/api/prescriptions/intake/qr", "/api/prescriptions/intake/image"]) {
        const event = {
          rawPath: path,
          headers: {
            cookie: "pharmacy_session=session-customer; pharmacy_csrf=valid-token-123",
            "x-csrf-token": "valid-token-123",
          },
          requestContext: { http: { method: "POST", path } },
        };

        const result = await authorizer(event);
        assert.equal(result.isAuthorized, true, `${path} should be authorized`);
        assert.equal(result.context.actorType, "customer");
        assert.equal(result.context.actorId, mockCustomer.id);
      }
    });

    it("denies anonymous prescription intake even when the CSRF token is valid", async () => {
      const event = {
        rawPath: "/api/prescriptions/intake/qr",
        headers: { cookie: "pharmacy_csrf=valid-token-123", "x-csrf-token": "valid-token-123" },
        requestContext: { http: { method: "POST", path: "/api/prescriptions/intake/qr" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("still requires CSRF for prescription intake posts", async () => {
      const noTokenEvent = {
        rawPath: "/api/prescriptions/intake/image",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "POST", path: "/api/prescriptions/intake/image" } },
      };
      assert.equal((await authorizer(noTokenEvent)).isAuthorized, false);

      const mismatchedTokenEvent = {
        rawPath: "/api/prescriptions/intake/image",
        headers: {
          cookie: "pharmacy_session=session-customer; pharmacy_csrf=token-a",
          "x-csrf-token": "token-b",
        },
        requestContext: { http: { method: "POST", path: "/api/prescriptions/intake/image" } },
      };
      assert.equal((await authorizer(mismatchedTokenEvent)).isAuthorized, false);
    });

    it("allows a signed-in customer to read their own prescription list", async () => {
      const event = {
        rawPath: "/api/prescriptions",
        queryStringParameters: { limit: "50" },
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "customer");
      assert.equal(result.context.actorId, mockCustomer.id);

      // Sales-service forces the owner filter for a customer, so the staff site scoping rules must not apply here.
      const siteFilteredEvent = {
        rawPath: "/api/prescriptions",
        queryStringParameters: { siteId: "22222222-2222-4222-8222-222222222222" },
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(siteFilteredEvent)).isAuthorized, true);
    });

    it("denies an anonymous prescription list read", async () => {
      const event = {
        rawPath: "/api/prescriptions",
        rawQueryString: "limit=50",
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };

      assert.equal((await authorizer(event)).isAuthorized, false);
    });

    it("keeps customers out of the other /api/prescriptions paths", async () => {
      const detailEvent = {
        rawPath: "/api/prescriptions/123",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions/123" } },
      };
      assert.equal((await authorizer(detailEvent)).isAuthorized, false);

      // The CSRF token is valid, so the denial comes from the employee rule rather than the double-submit check.
      const createEvent = {
        rawPath: "/api/prescriptions",
        headers: {
          cookie: "pharmacy_session=session-customer; pharmacy_csrf=valid-token-123",
          "x-csrf-token": "valid-token-123",
        },
        requestContext: { http: { method: "POST", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(createEvent)).isAuthorized, false);
    });

    it("keeps employee behaviour on the prescription domain unchanged", async () => {
      // Staff can still use intake, and no role is demanded there.
      const pharmacistIntakeEvent = {
        rawPath: "/api/prescriptions/intake/qr",
        headers: {
          cookie: "pharmacy_session=session-pharmacist; pharmacy_csrf=valid-token-123",
          "x-csrf-token": "valid-token-123",
        },
        requestContext: { http: { method: "POST", path: "/api/prescriptions/intake/qr" } },
      };
      const pharmacistIntakeResult = await authorizer(pharmacistIntakeEvent);
      assert.equal(pharmacistIntakeResult.isAuthorized, true);
      assert.equal(pharmacistIntakeResult.context.actorType, "employee");

      const pharmacistListEvent = {
        rawPath: "/api/prescriptions",
        headers: { cookie: "pharmacy_session=session-pharmacist" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(pharmacistListEvent)).isAuthorized, true);

      const warehouseListEvent = {
        rawPath: "/api/prescriptions",
        headers: { cookie: "pharmacy_session=session-warehouse" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(warehouseListEvent)).isAuthorized, false);

      // The list read is shared with shoppers, but the Pharmacist requirement still applies to staff callers.
      const managerListEvent = {
        rawPath: "/api/prescriptions",
        headers: { cookie: "pharmacy_session=session-manager" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(managerListEvent)).isAuthorized, false);

      const pharmacistOwnSiteEvent = {
        rawPath: "/api/prescriptions",
        queryStringParameters: { siteId: "11111111-1111-4111-8111-111111111111" },
        headers: { cookie: "pharmacy_session=session-pharmacist" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(pharmacistOwnSiteEvent)).isAuthorized, true);

      const pharmacistOtherSiteEvent = {
        rawPath: "/api/prescriptions",
        queryStringParameters: { siteId: "22222222-2222-4222-8222-222222222222" },
        headers: { cookie: "pharmacy_session=session-pharmacist" },
        requestContext: { http: { method: "GET", path: "/api/prescriptions" } },
      };
      assert.equal((await authorizer(pharmacistOtherSiteEvent)).isAuthorized, false);

      // A path that merely shares text with the intake prefix keeps the Pharmacist requirement.
      const warehouseIntakeLegacyEvent = {
        rawPath: "/api/prescriptions/intake-legacy",
        headers: {
          cookie: "pharmacy_session=session-warehouse; pharmacy_csrf=valid-token-123",
          "x-csrf-token": "valid-token-123",
        },
        requestContext: { http: { method: "POST", path: "/api/prescriptions/intake-legacy" } },
      };
      assert.equal((await authorizer(warehouseIntakeLegacyEvent)).isAuthorized, false);
    });
  });

  describe("site scoping checks", () => {
    it("allows employee querying assigned siteId", async () => {
      const event = {
        rawPath: "/api/inventory/movements",
        queryStringParameters: { siteId: "11111111-1111-4111-8111-111111111111" },
        headers: { cookie: "pharmacy_session=session-warehouse" },
        requestContext: { http: { method: "GET", path: "/api/inventory/movements" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
    });

    it("denies employee querying unassigned siteId", async () => {
      const event = {
        rawPath: "/api/inventory/movements",
        queryStringParameters: { siteId: "22222222-2222-4222-8222-222222222222" },
        headers: { cookie: "pharmacy_session=session-warehouse" },
        requestContext: { http: { method: "GET", path: "/api/inventory/movements" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, false);
    });

    it("denies site-scoped list route if employee has no site assigned", async () => {
      const employeeNoSites = {
        id: "00000000-0000-4000-8000-000000000099",
        actorType: "employee",
        roles: ["Warehouse Staff"],
        siteIds: [],
      };

      const customAuth = createAuthorizerHandler({
        internalIdentitySecret: testSecret,
        fetchFn: createMockFetch({ "session-nosites": employeeNoSites }),
        nowFn: () => fixedNow,
      });

      const event = {
        rawPath: "/api/inventory/balances",
        headers: { cookie: "pharmacy_session=session-nosites" },
        requestContext: { http: { method: "GET", path: "/api/inventory/balances" } },
      };

      const result = await customAuth(event);
      assert.equal(result.isAuthorized, false);
    });

    it("allows Platform Admin to access arbitrary siteId and site-scoped lists with empty siteIds", async () => {
      const event = {
        rawPath: "/api/inventory/balances",
        queryStringParameters: { siteId: "22222222-2222-4222-8222-222222222222" },
        headers: { cookie: "pharmacy_session=session-admin" },
        requestContext: { http: { method: "GET", path: "/api/inventory/balances" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
    });
  });

  describe("API Gateway payload format 2.0 event handling", () => {
    it("handles event.cookies array format", async () => {
      const event = {
        rawPath: "/api/orders",
        cookies: ["pharmacy_session=session-customer", "pharmacy_csrf=token-123"],
        headers: { "x-csrf-token": "token-123" },
        requestContext: { http: { method: "POST", path: "/api/orders" } },
      };

      const result = await authorizer(event);
      assert.equal(result.isAuthorized, true);
      assert.equal(result.context.actorType, "customer");
    });

    it("handles rawQueryString when queryStringParameters is omitted", async () => {
      const event = {
        rawPath: "/api/inventory/movements",
        rawQueryString: "siteId=22222222-2222-4222-8222-222222222222",
        headers: { cookie: "pharmacy_session=session-warehouse" },
        requestContext: { http: { method: "GET", path: "/api/inventory/movements" } },
      };

      const result = await authorizer(event);
      // Denied because warehouse employee is only assigned site-1
      assert.equal(result.isAuthorized, false);
    });

    it("fails safely when INTERNAL_IDENTITY_SECRET is missing", async () => {
      const brokenAuth = createAuthorizerHandler({
        internalIdentitySecret: "",
      });

      const result = await brokenAuth({ rawPath: "/api/products" });
      assert.equal(result.isAuthorized, false);
    });
  });

  describe("AWS Secrets Manager ARN secret resolution", () => {
    const identitySecretArn =
      "arn:aws:secretsmanager:ap-southeast-1:000000000000:secret:pharmacy-central/staging/internal-identity";
    const serviceSecretArn =
      "arn:aws:secretsmanager:ap-southeast-1:000000000000:secret:pharmacy-central/staging/internal-service";
    const resolvedIdentitySecret = "resolved-secret-from-secrets-manager";
    const resolvedServiceSecret = "resolved-service-secret-from-secrets-manager";

    it("resolves INTERNAL_IDENTITY_SECRET and INTERNAL_SERVICE_SECRET from ARNs using injected mock client", async () => {
      let interceptedServiceSecretHeader;
      const customFetch = async (url, options) => {
        interceptedServiceSecretHeader = options?.headers?.["x-internal-service-secret"];
        return createMockFetch(sessionMap)(url, options);
      };

      const secretsClient = {
        send: async (command) => {
          const secretId = command.SecretId || command.input?.SecretId;
          if (secretId === identitySecretArn) {
            return { SecretString: JSON.stringify({ INTERNAL_IDENTITY_SECRET: resolvedIdentitySecret }) };
          }
          if (secretId === serviceSecretArn) {
            return { SecretString: resolvedServiceSecret };
          }
          throw new Error(`Unknown secret ARN: ${secretId}`);
        },
      };

      const secretsAuthorizer = createAuthorizerHandler({
        internalIdentitySecret: identitySecretArn,
        internalServiceSecret: serviceSecretArn,
        secretsClient,
        fetchFn: customFetch,
        nowFn: () => fixedNow,
      });

      // Public route verification
      const publicEvent = {
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      };
      const publicResult = await secretsAuthorizer(publicEvent);
      assert.equal(publicResult.isAuthorized, true);

      const verified = decodeAndVerifyIdentityContext(
        publicResult.context.signedIdentityContext,
        resolvedIdentitySecret,
        fixedNow,
      );
      assert.ok(verified);
      assert.equal(verified.actorType, "system");

      // Protected customer route verification with service secret header check
      const protectedEvent = {
        rawPath: "/api/orders",
        headers: { cookie: "pharmacy_session=session-customer" },
        requestContext: { http: { method: "GET", path: "/api/orders" } },
      };
      const protectedResult = await secretsAuthorizer(protectedEvent);
      assert.equal(protectedResult.isAuthorized, true);
      assert.equal(protectedResult.context.actorId, mockCustomer.id);
      assert.equal(interceptedServiceSecretHeader, resolvedServiceSecret);
    });

    it("lazily caches resolved secrets across multiple invocations without redundant calls", async () => {
      let fetchCallCount = 0;
      const fetchSecret = async (arn, key) => {
        fetchCallCount++;
        if (arn === identitySecretArn) {
          return resolvedIdentitySecret;
        }
        return "";
      };

      const cachingAuthorizer = createAuthorizerHandler({
        internalIdentitySecret: identitySecretArn,
        fetchSecret,
        nowFn: () => fixedNow,
      });

      const event = {
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      };

      // First invocation fetches secret from Secrets Manager
      const res1 = await cachingAuthorizer(event);
      assert.equal(res1.isAuthorized, true);
      assert.equal(fetchCallCount, 1);

      // Second invocation reuses cached secret
      const res2 = await cachingAuthorizer(event);
      assert.equal(res2.isAuthorized, true);
      assert.equal(fetchCallCount, 1);

      // Third invocation reuses cached secret
      const res3 = await cachingAuthorizer(event);
      assert.equal(res3.isAuthorized, true);
      assert.equal(fetchCallCount, 1);
    });

    it("denies access when Secrets Manager resolution fails", async () => {
      const failingAuthorizer = createAuthorizerHandler({
        internalIdentitySecret: identitySecretArn,
        fetchSecret: async () => {
          throw new Error("Secrets Manager AccessDeniedException: User is not authorized to perform secretsmanager:GetSecretValue");
        },
      });

      const result = await failingAuthorizer({
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      });
      assert.equal(result.isAuthorized, false);
      assert.deepEqual(result.context, {});
    });

    it("denies access when Secrets Manager returns an empty secret value", async () => {
      const emptyAuthorizer = createAuthorizerHandler({
        internalIdentitySecret: identitySecretArn,
        fetchSecret: async () => ({ SecretString: "" }),
      });

      const result = await emptyAuthorizer({
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      });
      assert.equal(result.isAuthorized, false);
      assert.deepEqual(result.context, {});
    });

    it("denies access when INTERNAL_SERVICE_SECRET ARN fails to resolve", async () => {
      const failingServiceAuth = createAuthorizerHandler({
        internalIdentitySecret: "literal-identity-key",
        internalServiceSecret: serviceSecretArn,
        fetchSecret: async (arn) => {
          if (arn === serviceSecretArn) {
            throw new Error("Service secret ARN not found");
          }
          return "";
        },
      });

      const result = await failingServiceAuth({
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      });
      assert.equal(result.isAuthorized, false);
    });

    it("supports environment variable ARNs with custom secretsResolver function", async () => {
      const prevIdentityEnv = process.env.INTERNAL_IDENTITY_SECRET;
      const prevServiceEnv = process.env.INTERNAL_SERVICE_SECRET;

      try {
        process.env.INTERNAL_IDENTITY_SECRET = identitySecretArn;
        process.env.INTERNAL_SERVICE_SECRET = serviceSecretArn;

        const customResolver = async (arn, keyName) => {
          if (keyName === "INTERNAL_IDENTITY_SECRET") {
            return "env-resolved-identity-secret";
          }
          if (keyName === "INTERNAL_SERVICE_SECRET") {
            return "env-resolved-service-secret";
          }
          return "";
        };

        const envAuthorizer = createAuthorizerHandler({
          secretsResolver: customResolver,
          nowFn: () => fixedNow,
        });

        const result = await envAuthorizer({
          rawPath: "/api/products",
          requestContext: { http: { method: "GET", path: "/api/products" } },
        });
        assert.equal(result.isAuthorized, true);

        const verified = decodeAndVerifyIdentityContext(
          result.context.signedIdentityContext,
          "env-resolved-identity-secret",
          fixedNow,
        );
        assert.ok(verified);
      } finally {
        if (prevIdentityEnv !== undefined) {
          process.env.INTERNAL_IDENTITY_SECRET = prevIdentityEnv;
        } else {
          delete process.env.INTERNAL_IDENTITY_SECRET;
        }
        if (prevServiceEnv !== undefined) {
          process.env.INTERNAL_SERVICE_SECRET = prevServiceEnv;
        } else {
          delete process.env.INTERNAL_SERVICE_SECRET;
        }
      }
    });

    it("preserves literal test injection without calling Secrets Manager client", async () => {
      let clientInvoked = false;
      const mockClient = {
        send: async () => {
          clientInvoked = true;
          throw new Error("Should not be called for literal secrets");
        },
      };

      const literalAuthorizer = createAuthorizerHandler({
        internalIdentitySecret: "literal-identity-secret",
        internalServiceSecret: "literal-service-secret",
        secretsClient: mockClient,
        nowFn: () => fixedNow,
      });

      const result = await literalAuthorizer({
        rawPath: "/api/products",
        requestContext: { http: { method: "GET", path: "/api/products" } },
      });

      assert.equal(result.isAuthorized, true);
      assert.equal(clientInvoked, false);

      const verified = decodeAndVerifyIdentityContext(
        result.context.signedIdentityContext,
        "literal-identity-secret",
        fixedNow,
      );
      assert.ok(verified);
    });
  });
});
