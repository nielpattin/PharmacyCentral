import { describe, expect, it } from "vitest";

import { deliveryView } from "./delivery-view.ts";

// The store from the reported incident sits east of the checkout page's default destination.
const store = { latitude: 21.0372, longitude: 105.7825 };
const destination = { latitude: 21.0547, longitude: 105.7605 };

describe("delivery view", () => {
  it("frames a store that sits east of the destination", () => {
    const view = deliveryView(store, destination);

    expect(view.getWest()).toBeCloseTo(105.7605, 6);
    expect(view.getEast()).toBeCloseTo(105.7825, 6);
    expect(view.getSouth()).toBeCloseTo(21.0372, 6);
    expect(view.getNorth()).toBeCloseTo(21.0547, 6);
    // Reading the pair as a fixed south-west/north-east corner used to wrap this box 360° the other
    // way round the globe, framing the whole world on the Atlantic instead of Hanoi.
    expect(view.getCenter().lng).toBeCloseTo(105.7715, 6);
  });

  it("frames a store that sits west of the destination", () => {
    const view = deliveryView({ latitude: 21.0542, longitude: 105.6785 }, { latitude: 21.0342, longitude: 105.7785 });

    expect(view.getWest()).toBeCloseTo(105.6785, 6);
    expect(view.getEast()).toBeCloseTo(105.7785, 6);
    expect(view.getSouth()).toBeCloseTo(21.0342, 6);
    expect(view.getNorth()).toBeCloseTo(21.0542, 6);
  });

  it("widens the view to include the delivery route", () => {
    const view = deliveryView(store, destination, [
      [105.7825, 21.0372],
      [105.7285, 21.0142],
      [105.6785, 21.0742],
    ]);

    expect(view.getWest()).toBeCloseTo(105.6785, 6);
    expect(view.getEast()).toBeCloseTo(105.7825, 6);
    expect(view.getSouth()).toBeCloseTo(21.0142, 6);
    expect(view.getNorth()).toBeCloseTo(21.0742, 6);
  });
});
