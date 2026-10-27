import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyInternalIdentityContext } from "../middleware/trusted-request.ts";
import { signCatalogIdentity } from "./catalog-identity.ts";

const secret = "test-identity-secret";
const now = new Date("2026-01-01T00:00:00.000Z");
const actorId = "00000000-0000-4000-8000-000000000001";
const siteId = "00000000-0000-4000-8000-000000000003";

const requestWith = (headers: Record<string, string>): Request =>
  ({ header: (name: string) => headers[name.toLowerCase()] }) as unknown as Request;

const manager = requestWith({
  "x-actor-id": actorId,
  "x-actor-roles": "Pharmacy Manager",
  "x-actor-site-ids": siteId,
  "x-request-id": "req-2",
  "x-correlation-id": "corr-2",
});

// catalog-service verifies this same string in src/middleware/inventory-signed-context.test.ts, so the two tests
// together prove that the catalog accepts what the dashboard signs. Regenerate it in both places if the signer changes.
const signedForCatalog =
  "eyJjb250ZXh0Ijp7InZlcnNpb24iOiJ2MSIsInJlcXVlc3RJZCI6InJlcS0yIiwiY29ycmVsYXRpb25JZCI6ImNvcnItMiIsImFjdG9ySWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJhY3RvclR5cGUiOiJlbXBsb3llZSIsInJvbGVzIjpbIlBoYXJtYWN5IE1hbmFnZXIiXSwic2l0ZUlkcyI6WyIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDMiXSwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjMwLjAwMFoiLCJhdWRpZW5jZSI6ImNhdGFsb2ctc2VydmljZSJ9LCJhbGdvcml0aG0iOiJobWFjLXNoYTI1NiIsInNpZ25hdHVyZSI6IjI3NTNiZDllMDFkMGQ1YTUzMTMwZjE1OGMwNzI4M2I5Y2E2ZTZiNDZhMzA4Y2Y1MGU5NDZmYTI5NDgxZDc5ZGUifQ";

describe("signCatalogIdentity", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_IDENTITY_SECRET", secret);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs the employee who asked for the catalog and nobody else", () => {
    const context = verifyInternalIdentityContext(signCatalogIdentity(manager, now), secret, now, "catalog-service");

    expect(context).toMatchObject({
      actorId,
      actorType: "employee",
      roles: ["Pharmacy Manager"],
      siteIds: [siteId],
      audience: "catalog-service",
    });
    expect(
      verifyInternalIdentityContext(signCatalogIdentity(manager, now), secret, now, "sales-service"),
    ).toBeUndefined();
  });

  it("produces exactly the bytes the catalog is tested against", () => {
    expect(signCatalogIdentity(manager, now)).toBe(signedForCatalog);
  });

  it("lasts 30 seconds and carries no site list for Platform Admin", () => {
    const header = signCatalogIdentity(requestWith({ "x-actor-id": actorId, "x-actor-roles": "Platform Admin" }), now);

    expect(
      verifyInternalIdentityContext(header, secret, new Date(now.getTime() + 29_000), "catalog-service"),
    ).toMatchObject({
      siteIds: [],
    });
    expect(
      verifyInternalIdentityContext(header, secret, new Date(now.getTime() + 31_000), "catalog-service"),
    ).toBeUndefined();
  });

  it("refuses to sign when no employee asked", () => {
    expect(() => signCatalogIdentity(requestWith({ "x-actor-type": "system" }), now)).toThrow("employee who asked");
  });
});
