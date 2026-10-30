import { describe, expect, it } from "vitest";

import {
  addDays,
  firstDayOf,
  formatDay,
  formatDayLabel,
  inclusiveDayCount,
  isPeriodPreset,
  lastDayBefore,
  MAX_PERIOD_DAYS,
  monthOf,
  monthRange,
  parseDay,
  periodBounds,
  periodRangeError,
  presetRange,
} from "./period.ts";

// Local-time dates: the rules are about local calendar days, so the fixtures are built with local constructors.
const OCT_28 = new Date(2026, 9, 28);

describe("presetRange", () => {
  it("ends today and counts the preset's days back, both ends inclusive", () => {
    expect(presetRange("7d", OCT_28)).toEqual({ fromDay: "2026-10-22", toDay: "2026-10-28" });
    expect(presetRange("30d", OCT_28)).toEqual({ fromDay: "2026-09-29", toDay: "2026-10-28" });
    expect(presetRange("90d", OCT_28)).toEqual({ fromDay: "2026-07-31", toDay: "2026-10-28" });
  });

  it("starts this month on its first day", () => {
    expect(presetRange("month", OCT_28)).toEqual({ fromDay: "2026-10-01", toDay: "2026-10-28" });
    expect(presetRange("month", new Date(2026, 9, 1))).toEqual({ fromDay: "2026-10-01", toDay: "2026-10-01" });
  });

  it("crosses a year boundary", () => {
    expect(presetRange("7d", new Date(2026, 0, 3))).toEqual({ fromDay: "2025-12-28", toDay: "2026-01-03" });
  });

  it("counts the same number of days as the preset name says", () => {
    for (const preset of ["7d", "30d", "90d"] as const) {
      const range = presetRange(preset, OCT_28);
      expect(inclusiveDayCount(range), preset).toBe(Number(preset.replace("d", "")));
    }
  });
});

describe("periodRangeError", () => {
  it("accepts a one-day range", () => {
    expect(periodRangeError({ fromDay: "2026-10-28", toDay: "2026-10-28" })).toBeUndefined();
  });

  it("asks for both dates when one is missing", () => {
    expect(periodRangeError({ fromDay: "", toDay: "2026-10-28" })).toBe("missing");
    expect(periodRangeError({ fromDay: "2026-10-01", toDay: "" })).toBe("missing");
  });

  it("refuses a date that is not a real calendar day", () => {
    expect(periodRangeError({ fromDay: "2026-02-30", toDay: "2026-03-01" })).toBe("invalid");
    expect(periodRangeError({ fromDay: "2026-1-5", toDay: "2026-03-01" })).toBe("invalid");
  });

  it("refuses a start after the end", () => {
    expect(periodRangeError({ fromDay: "2026-10-28", toDay: "2026-10-27" })).toBe("order");
  });

  it("allows the longest range and refuses one day more", () => {
    expect(MAX_PERIOD_DAYS).toBe(365);
    expect(periodRangeError({ fromDay: "2026-01-01", toDay: "2026-12-31" })).toBeUndefined();
    expect(periodRangeError({ fromDay: "2026-01-01", toDay: "2027-01-01" })).toBe("tooLong");
  });
});

describe("periodBounds", () => {
  it("sends local midnight at the start and the local midnight after the last day", () => {
    expect(periodBounds({ fromDay: "2026-10-22", toDay: "2026-10-28" })).toEqual({
      from: new Date(2026, 9, 22).toISOString(),
      to: new Date(2026, 9, 29).toISOString(),
    });
  });

  it("makes a single day span exactly one day", () => {
    const bounds = periodBounds({ fromDay: "2026-10-28", toDay: "2026-10-28" });
    expect(Date.parse(bounds.to) - Date.parse(bounds.from)).toBeGreaterThan(0);
    expect(new Date(bounds.from).getDate()).toBe(28);
    expect(new Date(bounds.to).getDate()).toBe(29);
  });

  it("is read back to the same days", () => {
    const range = { fromDay: "2026-09-29", toDay: "2026-10-28" };
    const bounds = periodBounds(range);
    expect(firstDayOf(bounds.from)).toBe(range.fromDay);
    expect(lastDayBefore(bounds.to)).toBe(range.toDay);
  });

  it("refuses a range that is not valid", () => {
    expect(() => periodBounds({ fromDay: "", toDay: "" })).toThrow();
  });
});

describe("day helpers", () => {
  it("turns a month into its whole inclusive day range, leap February included", () => {
    expect(monthRange("2026-10")).toEqual({ fromDay: "2026-10-01", toDay: "2026-10-31" });
    expect(monthRange("2024-02")).toEqual({ fromDay: "2024-02-01", toDay: "2024-02-29" });
    expect(monthRange("2026-11")).toEqual({ fromDay: "2026-11-01", toDay: "2026-11-30" });
  });

  it("refuses a month that is not real and writes the local month of a date", () => {
    expect(monthRange("2026-13")).toBeUndefined();
    expect(monthRange("2026-1")).toBeUndefined();
    expect(monthRange("Oct 2026")).toBeUndefined();
    expect(monthOf(new Date(2026, 9, 28))).toBe("2026-10");
    expect(monthOf(new Date(2026, 0, 5))).toBe("2026-01");
  });

  it("parses only real days and formats them back", () => {
    expect(parseDay("2026-10-28")).toEqual(new Date(2026, 9, 28));
    expect(parseDay("2024-02-29")).toEqual(new Date(2024, 1, 29));
    expect(parseDay("2025-02-29")).toBeUndefined();
    expect(parseDay("28/10/2026")).toBeUndefined();
    expect(formatDay(new Date(2026, 9, 5))).toBe("2026-10-05");
  });

  it("adds whole days across a month end", () => {
    expect(formatDay(addDays(new Date(2026, 9, 31), 1))).toBe("2026-11-01");
    expect(formatDay(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
  });

  it("counts inclusive days", () => {
    expect(inclusiveDayCount({ fromDay: "2026-10-28", toDay: "2026-10-28" })).toBe(1);
    expect(inclusiveDayCount({ fromDay: "2026-02-01", toDay: "2026-03-01" })).toBe(29);
  });

  it("labels a day in the screen's locale", () => {
    expect(formatDayLabel("2026-10-22", "en-US")).toBe("Oct 22, 2026");
  });

  it("recognises the presets and nothing else", () => {
    expect(isPeriodPreset("30d")).toBe(true);
    expect(isPeriodPreset("custom")).toBe(true);
    expect(isPeriodPreset("365d")).toBe(false);
  });
});
