import { describe, expect, it } from "vitest";

import { deliveryView } from "./delivery-view.ts";

// The store from the reported incident sits east of the checkout page's default destination.
const store = { latitude: 10.773, longitude: 106.704 };
const destination = { latitude: 10.7905, longitude: 106.682 };

describe("delivery view", () => {
  it("frames a store that sits east of the destination", () => {
    const view = deliveryView(store, destination);

    expect(view.getWest()).toBeCloseTo(106.682, 6);
    expect(view.getEast()).toBeCloseTo(106.704, 6);
    expect(view.getSouth()).toBeCloseTo(10.773, 6);
    expect(view.getNorth()).toBeCloseTo(10.7905, 6);
    // Reading the pair as a fixed south-west/north-east corner used to wrap this box 360° the other
    // way round the globe, framing the whole world on the Atlantic instead of Ho Chi Minh City.
    expect(view.getCenter().lng).toBeCloseTo(106.693, 6);
  });

  it("frames a store that sits west of the destination", () => {
    const view = deliveryView({ latitude: 10.79, longitude: 106.6 }, { latitude: 10.77, longitude: 106.7 });

    expect(view.getWest()).toBeCloseTo(106.6, 6);
    expect(view.getEast()).toBeCloseTo(106.7, 6);
    expect(view.getSouth()).toBeCloseTo(10.77, 6);
    expect(view.getNorth()).toBeCloseTo(10.79, 6);
  });

  it("widens the view to include the delivery route", () => {
    const view = deliveryView(store, destination, [
      [106.704, 10.773],
      [106.65, 10.75],
      [106.6, 10.81],
    ]);

    expect(view.getWest()).toBeCloseTo(106.6, 6);
    expect(view.getEast()).toBeCloseTo(106.704, 6);
    expect(view.getSouth()).toBeCloseTo(10.75, 6);
    expect(view.getNorth()).toBeCloseTo(10.81, 6);
  });
});
