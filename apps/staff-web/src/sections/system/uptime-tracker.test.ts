import { describe, expect, it } from "vitest";

import { availabilityTone, availabilityTrackerData } from "./uptime-tracker.ts";

describe("availabilityTone", () => {
  it("is neutral without a sample and classifies the ratio at the thresholds", () => {
    expect(availabilityTone(null)).toBe("neutral");
    expect(availabilityTone(1)).toBe("ok");
    expect(availabilityTone(0.999)).toBe("ok");
    expect(availabilityTone(0.998)).toBe("warning");
    expect(availabilityTone(0.95)).toBe("warning");
    expect(availabilityTone(0.949)).toBe("danger");
    expect(availabilityTone(0)).toBe("danger");
  });
});

describe("availabilityTrackerData", () => {
  it("keeps the server's order and formats each tooltip from its own step", () => {
    const data = availabilityTrackerData(
      [
        [100, 1],
        [160, null],
        [220, 0.5],
      ],
      (time, ratio) => `${time}:${ratio ?? "none"}`,
    );
    expect(data).toEqual([
      { key: "100", tone: "ok", tooltip: "100:1" },
      { key: "160", tone: "neutral", tooltip: "160:none" },
      { key: "220", tone: "danger", tooltip: "220:0.5" },
    ]);
  });
});
