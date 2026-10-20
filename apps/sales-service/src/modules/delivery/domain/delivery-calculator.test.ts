import { describe, expect, it } from "vitest";

import { DeliveryCalculator, DeliveryOutOfRangeError } from "./delivery-calculator.ts";
import { InMemoryDeliveryCache } from "../infrastructure/in-memory-delivery-cache.ts";

describe("delivery calculation", () => {
  it("uses the selected store, provider route distance, address note, and per-kilometer fee", async () => {
    const calculator = new DeliveryCalculator(
      {
        route: async () => ({
          distanceMeters: 8_500,
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
      { resolveAddress: async () => "Resolved address" },
      new InMemoryDeliveryCache(),
      {
        freeDistanceMeters: 2_000,
        baseFee: 5_000,
        perKilometer: 2_000,
        maxDistanceMeters: 10_000,
        cacheTtlSeconds: 300,
      },
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
      distanceMeters: 8_500,
      fee: 17_000,
    });
  });

  it("continues when the distributed cache is unavailable", async () => {
    const calculator = new DeliveryCalculator(
      {
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
      { resolveAddress: async () => "Address" },
      {
        get: async () => {
          throw new Error("Redis unavailable");
        },
        set: async () => {
          throw new Error("Redis unavailable");
        },
      },
      {
        freeDistanceMeters: 0,
        baseFee: 0,
        perKilometer: 1_000,
        maxDistanceMeters: 10_000,
        cacheTtlSeconds: 300,
      },
    );

    await expect(
      calculator.calculate({
        store: { id: "store-1", latitude: 1, longitude: 1 },
        destination: { latitude: 2, longitude: 2 },
      }),
    ).resolves.toMatchObject({ fee: 1_000 });
  });

  it("prices routes by free distance, base fee, and full extra kilometers, and refuses far routes", async () => {
    const quote = (distanceMeters: number) => {
      const calculator = new DeliveryCalculator(
        {
          route: async () => ({
            distanceMeters,
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
        { resolveAddress: async () => "Address" },
        new InMemoryDeliveryCache(),
        {
          freeDistanceMeters: 2_000,
          baseFee: 5_000,
          perKilometer: 2_000,
          maxDistanceMeters: 10_000,
          cacheTtlSeconds: 300,
        },
      );
      return calculator.calculate({
        store: { id: "store-1", latitude: 1, longitude: 1 },
        destination: { latitude: 2, longitude: 2 },
      });
    };

    expect((await quote(1_999)).fee).toBe(0);
    expect((await quote(2_000)).fee).toBe(5_000);
    expect((await quote(2_999)).fee).toBe(5_000);
    expect((await quote(3_000)).fee).toBe(7_000);
    expect((await quote(9_999)).fee).toBe(19_000);
    await expect(quote(10_000)).rejects.toBeInstanceOf(DeliveryOutOfRangeError);
  });

  it("returns cached calculations without calling the provider again", async () => {
    let calls = 0;
    const calculator = new DeliveryCalculator(
      {
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
      {
        resolveAddress: async () => {
          calls += 1;
          return "Address";
        },
      },
      new InMemoryDeliveryCache(),
      {
        freeDistanceMeters: 0,
        baseFee: 0,
        perKilometer: 1_000,
        maxDistanceMeters: 10_000,
        cacheTtlSeconds: 300,
      },
    );
    const input = { store: { id: "store-1", latitude: 1, longitude: 1 }, destination: { latitude: 2, longitude: 2 } };
    await calculator.calculate(input);
    await calculator.calculate(input);
    expect(calls).toBe(2);
  });
});
