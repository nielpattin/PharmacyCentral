import { describe, expect, it } from "vitest";

import {
  ANALYTICS_TABS,
  ANALYTICS_TAB_LABELS,
  ANALYTICS_TAB_SECTION,
  analyticsTab,
  analyticsTabOfLabel,
} from "./tabs.ts";

describe("analyticsTab", () => {
  it("keeps the five tab values", () => {
    for (const tab of ANALYTICS_TABS) expect(analyticsTab(tab)).toBe(tab);
  });

  it("falls back to the overview tab for an unknown or empty value", () => {
    expect(analyticsTab("Sales")).toBe("overview");
    expect(analyticsTab("")).toBe("overview");
    expect(analyticsTab("Revenue")).toBe("overview");
  });
});

describe("analyticsTabOfLabel", () => {
  it("maps each tab label back to its URL value", () => {
    for (const tab of ANALYTICS_TABS) expect(analyticsTabOfLabel(ANALYTICS_TAB_LABELS[tab])).toBe(tab);
  });
});

describe("ANALYTICS_TAB_SECTION", () => {
  it("sends a section for the four analytics tabs and none for the targets tab", () => {
    expect(ANALYTICS_TAB_SECTION.overview).toBe("overview");
    expect(ANALYTICS_TAB_SECTION.revenue).toBe("revenue");
    expect(ANALYTICS_TAB_SECTION.customers).toBe("customers");
    expect(ANALYTICS_TAB_SECTION.inventory).toBe("inventory");
    expect(ANALYTICS_TAB_SECTION.targets).toBeUndefined();
  });
});
