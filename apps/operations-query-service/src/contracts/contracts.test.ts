import { describe, expect, it } from "vitest";

import {
  auditEventSchema,
  dashboardSummarySchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  operationsQueryContractVersion,
  siteScopeQuerySchema,
} from "./index.ts";

describe("operations-query-service contracts", () => {
  it("exports operations-query contract version v1", () => {
    expect(operationsQueryContractVersion).toBe("v1");
  });

  it("validates site scope query and dashboard summary schemas", () => {
    const validQuery = siteScopeQuerySchema.safeParse({
      siteId: "00000000-0000-4000-8000-000000000010",
      from: "2026-01-01",
      to: "2026-01-31",
    });
    expect(validQuery.success).toBe(true);

    const validSummary = dashboardSummarySchema.safeParse({
      totalSites: 5,
      activeSites: 4,
      totalProducts: 150,
      totalQuantityOnHand: 2500,
      totalQuantityReserved: 50,
      pendingTransferCount: 2,
      openPrescriptionCount: 8,
      recentActivity: [
        {
          eventId: "00000000-0000-4000-8000-000000000001",
          eventType: "order.created",
          occurredAt: new Date().toISOString(),
        },
      ],
    });
    expect(validSummary.success).toBe(true);
  });

  it("validates audit event schema and common schemas", () => {
    const validAudit = auditEventSchema.safeParse({
      eventId: "00000000-0000-4000-8000-000000000001",
      actorId: "00000000-0000-4000-8000-000000000099",
      action: "user.login",
      entityType: "Account",
      entityId: "00000000-0000-4000-8000-000000000099",
    });
    expect(validAudit.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "audit.event",
        schemaVersion: "v1",
        producer: "operations-query-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: validAudit.data,
    });
    expect(validEnvelope.success).toBe(true);
  });
});
