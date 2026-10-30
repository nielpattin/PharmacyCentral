import { describe, expect, it } from "vitest";

import { transferSuggestions, type TransferPosition } from "./transfer-suggestions.ts";

const today = "2026-10-30";
const windowDays = 30;

const position = (overrides: Partial<TransferPosition> & { siteId: string }): TransferPosition => ({
  productId: "product-1",
  available: 0,
  dispensedQuantity: 0,
  earliestExpiry: "2027-12-31",
  ...overrides,
});

const suggest = (positions: TransferPosition[]) => transferSuggestions({ positions, windowDays, today });

describe("transferSuggestions", () => {
  it("moves the surplus of a well-covered site to a site below the trigger, filling it to the target", () => {
    const rows = suggest([
      // 300 on hand, 5 a day (60 days of cover); keeps 45 days, so 75 units may leave.
      position({ siteId: "source", available: 300, dispensedQuantity: 150 }),
      // 10 on hand, 2 a day (5 days of cover); 30 days of cover is 60 units, so it needs 50.
      position({ siteId: "destination", available: 10, dispensedQuantity: 60 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId: "product-1",
      sourceSiteId: "source",
      destinationSiteId: "destination",
      quantity: 50,
      sourceAvailable: 300,
      sourceDaysOfCover: 60,
      destinationAvailable: 10,
      destinationDaysOfCover: 5,
      destinationDailyVelocity: 2,
      earliestExpiry: "2027-12-31",
      cappedByExpiry: false,
    });
    expect(rows[0]?.daysToExpiry).toBeGreaterThan(0);
  });

  it("keeps a destination that is already above the trigger out of the list", () => {
    expect(
      suggest([
        position({ siteId: "source", available: 300, dispensedQuantity: 150 }),
        // 100 on hand at 2 a day is 50 days of cover.
        position({ siteId: "destination", available: 100, dispensedQuantity: 60 }),
      ]),
    ).toEqual([]);
  });

  it("does not take stock below the source's own cover", () => {
    expect(
      suggest([
        // 225 at 5 a day is exactly 45 days, so there is no surplus to give away.
        position({ siteId: "source", available: 225, dispensedQuantity: 150 }),
        position({ siteId: "destination", available: 10, dispensedQuantity: 60 }),
      ]),
    ).toEqual([]);
  });

  it("offers the stock of a site that did not sell in the window, with no cover to report", () => {
    const rows = suggest([
      position({ siteId: "source", available: 30, dispensedQuantity: 0 }),
      position({ siteId: "destination", available: 0, dispensedQuantity: 60 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 30, sourceDaysOfCover: null });
  });

  it("caps the quantity at what the destination can sell before the stock expires", () => {
    const rows = suggest([
      // 100 units that expire in 10 days, and the destination sells 2 a day.
      position({ siteId: "source", available: 100, dispensedQuantity: 0, earliestExpiry: "2026-11-09" }),
      position({ siteId: "destination", available: 0, dispensedQuantity: 60 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 20, daysToExpiry: 10, cappedByExpiry: true });
  });

  it("does not move stock that expires today", () => {
    expect(
      suggest([
        position({ siteId: "source", available: 100, dispensedQuantity: 0, earliestExpiry: today }),
        position({ siteId: "destination", available: 0, dispensedQuantity: 60 }),
      ]),
    ).toEqual([]);
  });

  it("serves the most urgent destination first and splits the source between destinations", () => {
    const rows = suggest([
      position({ siteId: "source", available: 300, dispensedQuantity: 150 }),
      // 2 on hand at 2 a day is 1 day of cover; 30 days of cover is 60, so it needs 58.
      position({ siteId: "urgent", available: 2, dispensedQuantity: 60 }),
      // 10 on hand at 2 a day is 5 days of cover, and it needs 50.
      position({ siteId: "soon", available: 10, dispensedQuantity: 60 }),
    ]);

    expect(rows.map((row) => [row.destinationSiteId, row.quantity])).toEqual([
      ["urgent", 58],
      ["soon", 17],
    ]);
  });

  it("suggests whole base units only", () => {
    const rows = suggest([
      position({ siteId: "source", available: 10.9, dispensedQuantity: 0 }),
      position({ siteId: "destination", available: 0, dispensedQuantity: 60 }),
    ]);

    expect(rows[0]?.quantity).toBe(10);
  });
});
