import { describe, expect, it } from "vitest";

import { comparedSeries, dailyPoints, dayStartSeconds, formatDay, hasNoDays, periodShift } from "./overview-series.ts";

const day = (date: string, revenue: number, orders = 0) => ({ date, revenue, orders });
const DAY = 86_400;

describe("dayStartSeconds", () => {
  it("is midnight of the date in UTC+7", () => {
    expect(dayStartSeconds("2026-10-08")).toBe(Date.UTC(2026, 9, 7, 17, 0, 0) / 1000);
  });

  it("is null for a label that is not a date", () => {
    expect(dayStartSeconds("soon")).toBeNull();
  });
});

describe("dailyPoints", () => {
  it("keeps zero-filled days as real zeros and drops unreadable labels", () => {
    const points = dailyPoints([day("2026-10-08", 0, 0), day("bad", 5), day("2026-10-09", 70, 2)], "revenue");
    expect(points.map(([, value]) => value)).toEqual([0, 70]);
    expect((points[1]?.[0] ?? 0) - (points[0]?.[0] ?? 0)).toBe(DAY);
  });

  it("reads the orders field and moves every point by the shift", () => {
    const [point] = dailyPoints([day("2026-10-08", 9, 4)], "orders", 100);
    expect(point?.[1]).toBe(4);
    expect(point?.[0]).toBe((dayStartSeconds("2026-10-08") ?? 0) + 100);
  });
});

describe("periodShift", () => {
  it("is the gap between the two first days", () => {
    expect(periodShift([day("2026-10-08", 1)], [day("2026-09-08", 1)])).toBe(30 * DAY);
  });

  it("is zero when a period is empty", () => {
    expect(periodShift([], [day("2026-09-08", 1)])).toBe(0);
    expect(periodShift([day("2026-10-08", 1)], [])).toBe(0);
  });
});

describe("comparedSeries", () => {
  const series = {
    current: [day("2026-10-08", 10), day("2026-10-09", 0)],
    previous: [day("2026-09-08", 4), day("2026-09-09", 6)],
  };

  it("lays the previous period over the current one day for day", () => {
    const [current, previous] = comparedSeries(series, "revenue", { current: "Now", previous: "Before" });
    expect(current).toMatchObject({ label: "Now", tone: "chart-1" });
    expect(previous).toMatchObject({ label: "Before", tone: "neutral" });
    expect(previous?.points.map(([time]) => time)).toEqual(current?.points.map(([time]) => time));
    expect(previous?.points.map(([, value]) => value)).toEqual([4, 6]);
  });

  it("keeps a zero day of the current period as 0", () => {
    const [current] = comparedSeries(series, "revenue", { current: "Now", previous: "Before" });
    expect(current?.points[1]?.[1]).toBe(0);
  });
});

describe("hasNoDays", () => {
  it("is true only when both periods are empty", () => {
    expect(hasNoDays({ current: [], previous: [] })).toBe(true);
    expect(hasNoDays({ current: [day("2026-10-08", 0)], previous: [] })).toBe(false);
  });
});

describe("formatDay", () => {
  it("writes the day and month in the pharmacy's zone", () => {
    expect(formatDay(dayStartSeconds("2026-10-08") ?? 0, "en-GB")).toBe("08/10");
  });
});
