import { describe, expect, it } from "vitest";

import {
  cartLineSchema,
  createOrderRequestSchema,
  createPrescriptionRequestSchema,
  deliveryCalculateRequestSchema,
  dispensePrescriptionRequestSchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  internalIdentityContextSchema,
  orderChangedEventSchema,
  orderTransitionSchema,
  salesContractVersion,
} from "./index.ts";

describe("sales-service contracts", () => {
  it("exports sales contract version v1", () => {
    expect(salesContractVersion).toBe("v1");
  });

  it("validates cart line and order creation schemas", () => {
    const validCartLine = cartLineSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000001",
      productUnitId: "00000000-0000-4000-8000-000000000002",
      quantity: 2,
    });
    expect(validCartLine.success).toBe(true);

    const validOrder = createOrderRequestSchema.safeParse({
      selectedStoreId: "00000000-0000-4000-8000-000000000010",
      fulfillmentType: "pickup",
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000001",
          productUnitId: "00000000-0000-4000-8000-000000000002",
          quantity: 2,
        },
      ],
    });
    expect(validOrder.success).toBe(true);
  });

  it("validates delivery calculation and order transition schemas", () => {
    const validDelivery = deliveryCalculateRequestSchema.safeParse({
      destination: { latitude: 10.762622, longitude: 106.660172 },
      selectedStoreId: "00000000-0000-4000-8000-000000000010",
      addressNote: "Leave at door",
    });
    expect(validDelivery.success).toBe(true);

    const validTransition = orderTransitionSchema.safeParse({
      status: "Confirmed",
    });
    expect(validTransition.success).toBe(true);

    const validOrderEvent = orderChangedEventSchema.safeParse({
      orderId: "00000000-0000-4000-8000-000000000001",
      status: "confirmed",
    });
    expect(validOrderEvent.success).toBe(true);
  });

  it("validates prescription creation, dispensing, and envelope schemas", () => {
    const validPrescription = createPrescriptionRequestSchema.safeParse({
      siteId: "00000000-0000-4000-8000-000000000010",
      storageLocationId: "00000000-0000-4000-8000-000000000020",
      patientName: "John Doe",
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000001",
          productUnitId: "00000000-0000-4000-8000-000000000002",
          prescribedQuantity: 10,
        },
      ],
    });
    expect(validPrescription.success).toBe(true);

    const validDispense = dispensePrescriptionRequestSchema.safeParse({
      lines: [
        {
          prescriptionLineId: "00000000-0000-4000-8000-000000000030",
          productBatchId: "00000000-0000-4000-8000-000000000040",
          dispensedQuantity: 10,
        },
      ],
    });
    expect(validDispense.success).toBe(true);

    const validIdentity = internalIdentityContextSchema.safeParse({
      version: "v1",
      requestId: "req-1",
      correlationId: "corr-1",
      actorType: "customer",
      roles: [],
      siteIds: [],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: "sales-service",
    });
    expect(validIdentity.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "order.changed",
        schemaVersion: "v1",
        producer: "sales-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: { orderId: "00000000-0000-4000-8000-000000000001", status: "confirmed" },
    });
    expect(validEnvelope.success).toBe(true);
  });
});
