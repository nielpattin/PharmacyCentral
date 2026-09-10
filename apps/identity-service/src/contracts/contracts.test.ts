import { describe, expect, it } from "vitest";

import {
  accountCreatedEventSchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  identityContractVersion,
  internalIdentityContextSchema,
  loginRequestSchema,
  problemDetailsSchema,
  registerRequestSchema,
  sessionUserSchema,
  signedInternalIdentityContextSchema,
} from "./index.ts";

describe("identity-service contracts", () => {
  it("exports identity contract version v1", () => {
    expect(identityContractVersion).toBe("v1");
  });

  it("validates register and login request payloads", () => {
    const validRegister = registerRequestSchema.safeParse({
      email: "user@example.com",
      password: "securepassword123",
      displayName: "Jane Doe",
    });
    expect(validRegister.success).toBe(true);

    const invalidRegister = registerRequestSchema.safeParse({
      email: "not-an-email",
      password: "short",
      displayName: "",
    });
    expect(invalidRegister.success).toBe(false);

    const validLogin = loginRequestSchema.safeParse({
      email: "user@example.com",
      password: "password12345",
    });
    expect(validLogin.success).toBe(true);
  });

  it("validates session user and account created event schemas", () => {
    const validUser = sessionUserSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "user@example.com",
      displayName: "Jane Doe",
      roles: ["Customer"],
      siteIds: [],
    });
    expect(validUser.success).toBe(true);

    const validEvent = accountCreatedEventSchema.safeParse({
      accountId: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "user@example.com",
    });
    expect(validEvent.success).toBe(true);
  });

  it("validates common internal identity and problem details schemas", () => {
    const validContext = internalIdentityContextSchema.safeParse({
      version: "v1",
      requestId: "req-1",
      correlationId: "corr-1",
      actorType: "employee",
      roles: ["Pharmacist"],
      siteIds: ["00000000-0000-4000-8000-000000000010"],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: "identity-service",
    });
    expect(validContext.success).toBe(true);

    if (validContext.success) {
      const validSigned = signedInternalIdentityContextSchema.safeParse({
        context: validContext.data,
        algorithm: "hmac-sha256",
        signature: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });
      expect(validSigned.success).toBe(true);
    }

    const validProblem = problemDetailsSchema.safeParse({
      type: "https://example.com/probs/bad-request",
      title: "Bad Request",
      status: 400,
    });
    expect(validProblem.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "account.created",
        schemaVersion: "v1",
        producer: "identity-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: { test: true },
    });
    expect(validEnvelope.success).toBe(true);
  });
});
