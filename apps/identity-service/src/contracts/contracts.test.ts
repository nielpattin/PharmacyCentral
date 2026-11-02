import { describe, expect, it } from "vitest";

import {
  accountCreatedEventSchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  identityContractVersion,
  loginRequestSchema,
  problemDetailsSchema,
  registerRequestSchema,
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

    const staffLogin = loginRequestSchema.safeParse({
      email: "user@example.com",
      password: "password12345",
      audience: "employee",
    });
    expect(staffLogin.success).toBe(true);
    expect(
      loginRequestSchema.safeParse({ email: "user@example.com", password: "x", audience: "shopper" }).success,
    ).toBe(false);
  });

  it("validates the account created event schema", () => {
    const validEvent = accountCreatedEventSchema.safeParse({
      accountId: "00000000-0000-4000-8000-000000000001",
      actorType: "customer",
      email: "user@example.com",
    });
    expect(validEvent.success).toBe(true);
  });

  it("validates problem details and event envelope schemas", () => {
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
