import { describe, expect, it } from "vitest";

import { frameAt, pointStepSeconds } from "./prometheus.ts";
import { ALL_SERVICES, rateSpan, selectorFor } from "./promql.ts";

describe("selectorFor", () => {
  it("matches one service exactly", () => {
    expect(selectorFor("sales-service", ["sales-service", "catalog-service"])).toBe('service_name="sales-service"');
  });

  it("matches only the configured names for the aggregate, escaping regex characters in them", () => {
    expect(selectorFor(ALL_SERVICES, ["sales-service", "catalog.v2"])).toBe(
      'service_name=~"sales-service|catalog\\\\.v2"',
    );
  });
});

describe("rateSpan", () => {
  it("gives a rate window of at least five minutes, and four steps above that", () => {
    expect(rateSpan(15).range).toBe(300);
    expect(rateSpan(360).range).toBe(1440);
  });
});

describe("pointStepSeconds and frameAt", () => {
  it("keeps every window to at most 61 inclusive points, and never finer than 15 s", () => {
    for (const minutes of [15, 60, 360, 1440]) {
      const step = pointStepSeconds(minutes);
      expect(step).toBeGreaterThanOrEqual(15);
      expect((minutes * 60) / step + 1).toBeLessThanOrEqual(61);
    }
    expect(pointStepSeconds(15)).toBe(15);
    expect(pointStepSeconds(1440)).toBe(1440);
  });

  it("aligns the end of the window to the step so series share timestamps", () => {
    const frame = frameAt(new Date("2026-10-24T03:00:37.000Z"), 15, 15);
    expect(frame.to % 15).toBe(0);
    expect(frame.to - frame.from).toBe(900);
  });
});
