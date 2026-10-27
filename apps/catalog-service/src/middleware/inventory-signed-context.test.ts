import { describe, expect, it } from "vitest";

import { verifyInternalIdentityContext } from "./trusted-request.ts";

// Signed by inventory-service's signCatalogIdentity (src/modules/catalog-identity.test.ts pins the same string) for the
// opening balance import. The services re-serialize the context in their schema order before checking the signature,
// so this fails if inventory writes the keys in another order or signs another audience.
const signedByInventory =
  "eyJjb250ZXh0Ijp7InZlcnNpb24iOiJ2MSIsInJlcXVlc3RJZCI6InJlcS0xIiwiY29ycmVsYXRpb25JZCI6ImNvcnItMSIsImFjdG9ySWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJhY3RvclR5cGUiOiJlbXBsb3llZSIsInJvbGVzIjpbIldhcmVob3VzZSBTdGFmZiIsIlBoYXJtYWN5IE1hbmFnZXIiXSwic2l0ZUlkcyI6WyIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDMiXSwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjMwLjAwMFoiLCJhdWRpZW5jZSI6ImNhdGFsb2ctc2VydmljZSJ9LCJhbGdvcml0aG0iOiJobWFjLXNoYTI1NiIsInNpZ25hdHVyZSI6IjM5NjQ5ZmUzOGU4Zjg0OGYzOWUxNDZlNjcyM2RmMDg2YTRjMzcxMTc1ZDU1N2M3YThmMDI1ZTUyMGUzMjc4ODMifQ";
const secret = "test-identity-secret";
const issued = new Date("2026-01-01T00:00:10.000Z");

const signedByOperationsQuery =
  "eyJjb250ZXh0Ijp7InZlcnNpb24iOiJ2MSIsInJlcXVlc3RJZCI6InJlcS0yIiwiY29ycmVsYXRpb25JZCI6ImNvcnItMiIsImFjdG9ySWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJhY3RvclR5cGUiOiJlbXBsb3llZSIsInJvbGVzIjpbIlBoYXJtYWN5IE1hbmFnZXIiXSwic2l0ZUlkcyI6WyIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDMiXSwiaXNzdWVkQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTAxLTAxVDAwOjAwOjMwLjAwMFoiLCJhdWRpZW5jZSI6ImNhdGFsb2ctc2VydmljZSJ9LCJhbGdvcml0aG0iOiJobWFjLXNoYTI1NiIsInNpZ25hdHVyZSI6IjI3NTNiZDllMDFkMGQ1YTUzMTMwZjE1OGMwNzI4M2I5Y2E2ZTZiNDZhMzA4Y2Y1MGU5NDZmYTI5NDgxZDc5ZGUifQ";

describe("a context signed by inventory-service for the opening balance import", () => {
  it("is accepted by the catalog with the importing employee's actor, roles and sites", () => {
    expect(verifyInternalIdentityContext(signedByInventory, secret, issued, "catalog-service")).toMatchObject({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Warehouse Staff", "Pharmacy Manager"],
      siteIds: ["00000000-0000-4000-8000-000000000003"],
      audience: "catalog-service",
    });
  });

  it("is refused after it expires and with another secret", () => {
    expect(
      verifyInternalIdentityContext(signedByInventory, secret, new Date("2026-01-01T00:00:31.000Z"), "catalog-service"),
    ).toBeUndefined();
    expect(
      verifyInternalIdentityContext(signedByInventory, "another-secret", issued, "catalog-service"),
    ).toBeUndefined();
  });

  it("is accepted from operations-query-service for the dashboard read, with a manager's site", () => {
    expect(verifyInternalIdentityContext(signedByOperationsQuery, secret, issued, "catalog-service")).toMatchObject({
      actorId: "00000000-0000-4000-8000-000000000001",
      actorType: "employee",
      roles: ["Pharmacy Manager"],
      siteIds: ["00000000-0000-4000-8000-000000000003"],
      audience: "catalog-service",
    });
  });
});
