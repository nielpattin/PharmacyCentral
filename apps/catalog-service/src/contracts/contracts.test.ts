import { describe, expect, it } from "vitest";

import {
  catalogContractVersion,
  eventEnvelopeSchema,
  eventMetadataSchema,
  internalIdentityContextSchema,
  problemDetailsSchema,
  productChangedEventSchema,
  productSearchQuerySchema,
  productSummarySchema,
  storeSchema,
} from "./index.ts";

describe("catalog-service contracts", () => {
  it("accepts the anonymous actor type in internal identity context", () => {
    const anonymous = internalIdentityContextSchema.safeParse({
      version: "v1",
      requestId: "req-1",
      correlationId: "corr-1",
      actorType: "anonymous",
      roles: [],
      siteIds: [],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: "catalog-service",
    });
    expect(anonymous.success).toBe(true);
  });

  it("exports catalog contract version v1", () => {
    expect(catalogContractVersion).toBe("v1");
  });

  it("validates product search query schema", () => {
    const valid = productSearchQuerySchema.safeParse({
      search: "Paracetamol",
      category: "Pain Relief",
      limit: 10,
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.limit).toBe(10);
    }

    const defaultLimit = productSearchQuerySchema.safeParse({});
    expect(defaultLimit.success).toBe(true);
    if (defaultLimit.success) {
      expect(defaultLimit.data.limit).toBe(20);
    }
  });

  it("validates product summary and store schemas", () => {
    const validProduct = productSummarySchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      sku: "SKU-001",
      name: "Paracetamol 500mg",
      category: "Pain Relief",
      manufacturer: "PharmaCorp",
      inStock: true,
    });
    expect(validProduct.success).toBe(true);

    const validStore = storeSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000010",
      code: "STORE-1",
      name: "Central Pharmacy",
      address: "123 Main St",
      latitude: 10.762622,
      longitude: 106.660172,
    });
    expect(validStore.success).toBe(true);
  });

  it("validates product changed event and common schemas", () => {
    const validEvent = productChangedEventSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000001",
      sku: "SKU-001",
      name: "Paracetamol 500mg",
      active: true,
    });
    expect(validEvent.success).toBe(true);

    const validIdentity = internalIdentityContextSchema.safeParse({
      version: "v1",
      requestId: "req-1",
      correlationId: "corr-1",
      actorType: "system",
      roles: [],
      siteIds: [],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: "catalog-service",
    });
    expect(validIdentity.success).toBe(true);

    const validProblem = problemDetailsSchema.safeParse({
      type: "https://example.com/probs/not-found",
      title: "Not Found",
      status: 404,
    });
    expect(validProblem.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "product.changed",
        schemaVersion: "v1",
        producer: "catalog-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: validEvent.data,
    });
    expect(validEnvelope.success).toBe(true);
  });
});
