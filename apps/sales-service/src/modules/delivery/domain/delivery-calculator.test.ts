import { describe, expect, it } from "vitest";

import { DeliveryCalculator } from "./delivery-calculator.ts";
import { InMemoryDeliveryCache } from "../infrastructure/in-memory-delivery-cache.ts";

describe("delivery calculation", () => {
  it("uses the selected store, provider route distance, address note, and per-kilometer fee", async () => {
    const calculator = new DeliveryCalculator(
      {
        resolveAddress: async () => "Resolved address",
        route: async () => ({
          distanceMeters: 12_500,
          durationSeconds: 1_800,
          geometry: {
            type: "LineString",
            coordinates: [
              [106.7, 10.7],
              [106.8, 10.8],
            ],
          },
        }),
      },
      new InMemoryDeliveryCache(),
      { perKilometer: 5_000, minimumFee: 20_000, maximumFee: 100_000, cacheTtlSeconds: 300 },
    );

    const result = await calculator.calculate({
      store: { id: "store-1", latitude: 10.7, longitude: 106.7 },
      destination: { latitude: 10.8, longitude: 106.8 },
      addressNote: "Floor 2",
    });
    expect(result).toMatchObject({
      selectedStoreId: "store-1",
      providerResolvedAddress: "Resolved address",
      addressNote: "Floor 2",
      distanceMeters: 12_500,
      fee: 62_500,
    });
  });

  it("continues when the distributed cache is unavailable", async () => {
    const calculator = new DeliveryCalculator(
      {
        resolveAddress: async () => "Address",
        route: async () => ({
          distanceMeters: 1_000,
          durationSeconds: 60,
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
            ],
          },
        }),
      },
      {
        get: async () => {
          throw new Error("Valkey unavailable");
        },
        set: async () => {
          throw new Error("Valkey unavailable");
        },
      },
      { perKilometer: 1_000, minimumFee: 0, maximumFee: 100_000, cacheTtlSeconds: 300 },
    );

    await expect(
      calculator.calculate({
        store: { id: "store-1", latitude: 1, longitude: 1 },
        destination: { latitude: 2, longitude: 2 },
      }),
    ).resolves.toMatchObject({ fee: 1_000 });
  });

  it("returns cached calculations without calling the provider again", async () => {
    let calls = 0;
    const calculator = new DeliveryCalculator(
      {
        resolveAddress: async () => {
          calls += 1;
          return "Address";
        },
        route: async () => {
          calls += 1;
          return {
            distanceMeters: 1_000,
            durationSeconds: 60,
            geometry: {
              type: "LineString",
              coordinates: [
                [1, 1],
                [2, 2],
              ],
            },
          };
        },
      },
      new InMemoryDeliveryCache(),
      { perKilometer: 1_000, minimumFee: 0, maximumFee: 100_000, cacheTtlSeconds: 300 },
    );
    const input = { store: { id: "store-1", latitude: 1, longitude: 1 }, destination: { latitude: 2, longitude: 2 } };
    await calculator.calculate(input);
    await calculator.calculate(input);
    expect(calls).toBe(2);
  });
});
