import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createIdentityContext,
  decodeAndVerifyIdentityContext,
  encodeSignedIdentityContext,
  signIdentityContext,
} from "../identity.mjs";

describe("identity - create, sign, and verify context", () => {
  const secret = "test-internal-identity-secret";
  const fixedNow = new Date("2026-01-01T00:00:00.000Z");

  it("creates default anonymous identity context", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      now: fixedNow,
      ttlMs: 30_000,
    });

    assert.equal(context.version, "v1");
    assert.equal(context.requestId, "req-123");
    assert.equal(context.correlationId, "req-123");
    assert.equal(context.actorType, "anonymous");
    assert.equal(context.actorId, undefined);
    assert.deepEqual(context.roles, []);
    assert.deepEqual(context.siteIds, []);
    assert.equal(context.issuedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(context.expiresAt, "2026-01-01T00:00:30.000Z");
    assert.equal(context.audience, "pharmacy-backend");
  });

  it("creates authenticated employee identity context", () => {
    const identity = {
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Warehouse Staff"],
      siteIds: ["11111111-1111-4111-8111-111111111111"],
    };

    const context = createIdentityContext({
      requestId: "req-123",
      correlationId: "corr-456",
      identity,
      audience: "inventory-service",
      now: fixedNow,
      ttlMs: 60_000,
    });

    assert.equal(context.requestId, "req-123");
    assert.equal(context.correlationId, "corr-456");
    assert.equal(context.actorType, "employee");
    assert.equal(context.actorId, "00000000-0000-4000-8000-000000000001");
    assert.deepEqual(context.roles, ["Warehouse Staff"]);
    assert.deepEqual(context.siteIds, ["11111111-1111-4111-8111-111111111111"]);
    assert.equal(context.audience, "inventory-service");
    assert.equal(context.issuedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(context.expiresAt, "2026-01-01T00:01:00.000Z");
    // A service verifies the signature over its own schema order, so a different order here is rejected.
    assert.deepEqual(Object.keys(context), [
      "version",
      "requestId",
      "correlationId",
      "actorId",
      "actorType",
      "roles",
      "siteIds",
      "issuedAt",
      "expiresAt",
      "audience",
    ]);
  });

  it("signs and encodes context", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      now: fixedNow,
    });

    const signed = signIdentityContext(context, secret);
    assert.equal(signed.algorithm, "hmac-sha256");
    assert.match(signed.signature, /^[a-f0-9]{64}$/);
    assert.deepEqual(signed.context, context);

    const encoded = encodeSignedIdentityContext(signed);
    assert.ok(typeof encoded === "string");
    assert.ok(encoded.length > 0);
  });

  it("fails to sign when secret is missing", () => {
    const context = createIdentityContext({ requestId: "req-1" });
    assert.throws(() => signIdentityContext(context, ""), /INTERNAL_IDENTITY_SECRET is required/);
  });

  it("decodes and verifies valid signed identity header", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      identity: { id: "00000000-0000-4000-8000-000000000001", actorType: "customer" },
      now: fixedNow,
      ttlMs: 30_000,
    });

    const signed = signIdentityContext(context, secret);
    const header = encodeSignedIdentityContext(signed);

    const verified = decodeAndVerifyIdentityContext(header, secret, new Date("2026-01-01T00:00:15.000Z"));
    assert.deepEqual(verified, context);
  });

  it("rejects signed header with wrong secret", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      now: fixedNow,
      ttlMs: 30_000,
    });

    const signed = signIdentityContext(context, secret);
    const header = encodeSignedIdentityContext(signed);

    const verified = decodeAndVerifyIdentityContext(header, "wrong-secret", new Date("2026-01-01T00:00:15.000Z"));
    assert.equal(verified, undefined);
  });

  it("rejects expired identity context", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      now: fixedNow,
      ttlMs: 30_000,
    });

    const signed = signIdentityContext(context, secret);
    const header = encodeSignedIdentityContext(signed);

    // 35 seconds later (expired)
    const verified = decodeAndVerifyIdentityContext(header, secret, new Date("2026-01-01T00:00:35.000Z"));
    assert.equal(verified, undefined);
  });

  it("rejects tampered context", () => {
    const context = createIdentityContext({
      requestId: "req-123",
      now: fixedNow,
    });

    const signed = signIdentityContext(context, secret);
    // Tamper with context actorType
    signed.context.actorType = "employee";
    const header = encodeSignedIdentityContext(signed);

    const verified = decodeAndVerifyIdentityContext(header, secret, fixedNow);
    assert.equal(verified, undefined);
  });
});
