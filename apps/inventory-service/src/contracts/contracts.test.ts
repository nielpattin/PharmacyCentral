import { describe, expect, it } from "vitest";

import {
  availabilityChangedEventSchema,
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  eventEnvelopeSchema,
  eventMetadataSchema,
  goodsReceiptPostedEventSchema,
  inventoryContractVersion,
  procurementContractVersion,
  purchaseOrderActionSchema,
  reservationChangedEventSchema,
  reserveStockCommandSchema,
  stockMovementCommandSchema,
} from "./index.ts";

describe("goods receipt line unit cost", () => {
  const receipt = (unitCost?: number | null) => ({
    receiptNumber: "GR-1",
    supplierId: "00000000-0000-4000-8000-000000000001",
    siteId: "00000000-0000-4000-8000-000000000002",
    storageLocationId: "00000000-0000-4000-8000-000000000003",
    receivedAt: "2026-10-20T00:00:00Z",
    lines: [
      {
        productId: "00000000-0000-4000-8000-000000000004",
        batchNumber: "B1",
        expiryDate: "2027-01-01",
        quantity: 5,
        ...(unitCost === undefined ? {} : { unitCost }),
      },
    ],
  });

  it.each([[undefined], [null], [0], [1500], [1234.56]])("accepts a cost of %s", (unitCost) => {
    expect(createGoodsReceiptRequestSchema.safeParse(receipt(unitCost)).success).toBe(true);
  });

  it.each([[-1], [10.123], [1_000_000_001], [Number.NaN]])("refuses a cost of %s", (unitCost) => {
    expect(createGoodsReceiptRequestSchema.safeParse(receipt(unitCost)).success).toBe(false);
  });
});

describe("inventory-service contracts", () => {
  it("exports contract versions v1", () => {
    expect(inventoryContractVersion).toBe("v1");
    expect(procurementContractVersion).toBe("v1");
  });

  it("validates reserve stock command schema", () => {
    const valid = reserveStockCommandSchema.safeParse({
      reservationId: "00000000-0000-4000-8000-000000000001",
      sourceSiteId: "00000000-0000-4000-8000-000000000010",
      sourceLocationId: "00000000-0000-4000-8000-000000000020",
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000002",
          quantity: 5,
        },
      ],
    });
    expect(valid.success).toBe(true);

    const invalid = reserveStockCommandSchema.safeParse({
      reservationId: "bad-uuid",
      sourceSiteId: "bad-uuid",
      sourceLocationId: "bad-uuid",
      lines: [],
    });
    expect(invalid.success).toBe(false);
  });

  it("validates stock movement command schema and inventory events", () => {
    const valid = stockMovementCommandSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000002",
      siteId: "00000000-0000-4000-8000-000000000010",
      storageLocationId: "00000000-0000-4000-8000-000000000020",
      quantityDelta: 10,
      movementType: "Adjustment",
    });
    expect(valid.success).toBe(true);

    const validAvail = availabilityChangedEventSchema.safeParse({
      productId: "00000000-0000-4000-8000-000000000002",
      siteId: "00000000-0000-4000-8000-000000000010",
      inStock: true,
    });
    expect(validAvail.success).toBe(true);

    const validResEvent = reservationChangedEventSchema.safeParse({
      reservationId: "00000000-0000-4000-8000-000000000001",
      status: "active",
    });
    expect(validResEvent.success).toBe(true);
  });

  it("validates procurement purchase order and goods receipt schemas", () => {
    const validPO = createPurchaseOrderRequestSchema.safeParse({
      supplierId: "00000000-0000-4000-8000-000000000030",
      siteId: "00000000-0000-4000-8000-000000000010",
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000002",
          orderedQuantity: 100,
        },
      ],
    });
    expect(validPO.success).toBe(true);

    const validAction = purchaseOrderActionSchema.safeParse({
      action: "approve",
    });
    expect(validAction.success).toBe(true);

    const validReceipt = createGoodsReceiptRequestSchema.safeParse({
      receiptNumber: "GR-001",
      supplierId: "00000000-0000-4000-8000-000000000030",
      siteId: "00000000-0000-4000-8000-000000000010",
      storageLocationId: "00000000-0000-4000-8000-000000000020",
      receivedAt: new Date().toISOString(),
      lines: [
        {
          productId: "00000000-0000-4000-8000-000000000002",
          batchNumber: "BATCH-1",
          expiryDate: "2027-12-31",
          quantity: 100,
        },
      ],
    });
    expect(validReceipt.success).toBe(true);

    const validReceiptEvent = goodsReceiptPostedEventSchema.safeParse({
      goodsReceiptId: "00000000-0000-4000-8000-000000000050",
      siteId: "00000000-0000-4000-8000-000000000010",
      supplierId: "00000000-0000-4000-8000-000000000030",
      lineCount: 1,
    });
    expect(validReceiptEvent.success).toBe(true);

    const validEnvelope = eventEnvelopeSchema.safeParse({
      metadata: eventMetadataSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        eventType: "goods-receipt.posted",
        schemaVersion: "v1",
        producer: "inventory-service",
        occurredAt: new Date().toISOString(),
        correlationId: "corr-1",
      }),
      payload: validReceiptEvent.data,
    });
    expect(validEnvelope.success).toBe(true);
  });
});
