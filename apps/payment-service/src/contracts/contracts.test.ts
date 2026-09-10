import { describe, expect, it } from "vitest";

import {
  createInvoiceRequestSchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  internalIdentityContextSchema,
  invoiceLineSchema,
  paymentChangedEventSchema,
  paymentContractVersion,
  paymentStatusResponseSchema,
  paymentStatusSchema,
} from "./index.ts";

describe("payment-service contracts", () => {
  it("exports payment contract version v1", () => {
    expect(paymentContractVersion).toBe("v1");
  });

  it("validates invoice line and creation schemas", () => {
    const validLine = invoiceLineSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000001",
      productUnitId: "00000000-0000-4000-8000-000000000002",
      description: "Paracetamol 500mg (Box of 100)",
      quantity: 2,
      unitPrice: 50000,
      currency: "VND",
    });
    expect(validLine.success).toBe(true);

    const validInvoice = createInvoiceRequestSchema.safeParse({
      invoiceId: "00000000-0000-4000-8000-000000000010",
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000001",
          productUnitId: "00000000-0000-4000-8000-000000000002",
          description: "Paracetamol 500mg",
          quantity: 1,
          unitPrice: 50000,
          currency: "VND",
        },
      ],
      paymentMethod: "sepay_qr",
    });
    expect(validInvoice.success).toBe(true);
  });

  it("validates payment changed event and payment status response schemas", () => {
    const validStatus = paymentStatusSchema.safeParse("paid");
    expect(validStatus.success).toBe(true);

    const validEvent = paymentChangedEventSchema.safeParse({
      invoiceId: "00000000-0000-4000-8000-000000000010",
      status: "paid",
      provider: "sepay",
    });
    expect(validEvent.success).toBe(true);

    const validResponse = paymentStatusResponseSchema.safeParse({
      invoiceId: "00000000-0000-4000-8000-000000000010",
      status: "paid",
      amount: 50000,
      currency: "VND",
    });
    expect(validResponse.success).toBe(true);

    const validIdentity = internalIdentityContextSchema.safeParse({
      version: "v1",
      requestId: "req-1",
      correlationId: "corr-1",
      actorType: "system",
      roles: [],
      siteIds: [],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      audience: "payment-service",
    });
    expect(validIdentity.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "payment.changed",
        schemaVersion: "v1",
        producer: "payment-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: validEvent.data,
    });
    expect(validEnvelope.success).toBe(true);
  });
});
