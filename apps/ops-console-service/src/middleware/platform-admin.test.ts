import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyIdentityContext } from "./platform-admin.ts";

const SECRET = "test-internal-identity-secret";

export const signedIdentityHeader = (
  secret: string,
  audience: string,
  actorType: "customer" | "employee" | "system",
  roles: string[],
  overrides: { expiresInMs?: number } = {},
): string => {
  const now = Date.now();
  const context = {
    version: "v1" as const,
    requestId: "request-1",
    correlationId: "correlation-1",
    actorId: "55555555-5555-4555-8555-555555555555",
    actorType,
    roles,
    siteIds: [],
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + (overrides.expiresInMs ?? 300_000)).toISOString(),
    audience,
  };
  const signature = createHmac("sha256", secret).update(JSON.stringify(context)).digest("hex");
  return Buffer.from(JSON.stringify({ context, algorithm: "hmac-sha256", signature }), "utf8").toString("base64url");
};

describe("verifyIdentityContext", () => {
  const accept = (header: string | undefined, audience = "ops-console-service") =>
    verifyIdentityContext(header, SECRET, audience);

  it("accepts a signed, unexpired context for this service", () => {
    expect(accept(signedIdentityHeader(SECRET, "ops-console-service", "employee", ["Platform Admin"]))?.roles).toEqual([
      "Platform Admin",
    ]);
  });

  it("refuses a wrong signature, a wrong audience and an expired context", () => {
    expect(
      accept(signedIdentityHeader("another-secret", "ops-console-service", "employee", ["Platform Admin"])),
    ).toBeUndefined();
    expect(accept(signedIdentityHeader(SECRET, "sales-service", "employee", ["Platform Admin"]))).toBeUndefined();
    expect(
      accept(
        signedIdentityHeader(SECRET, "ops-console-service", "employee", ["Platform Admin"], { expiresInMs: -5_000 }),
      ),
    ).toBeUndefined();
    expect(accept("not-a-context")).toBeUndefined();
    expect(accept(undefined)).toBeUndefined();
  });
});
