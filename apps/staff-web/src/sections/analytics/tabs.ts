import type { AnalyticsSection } from "./contract.ts";

/**
 * The tabs of the Analytics page, in display order. The value is the `tab` search param; the label is the translation
 * key `SubTabs` shows. One tab owns one block of the page, so only the active tab is rendered.
 */
export const ANALYTICS_TABS = ["overview", "revenue", "customers", "inventory", "targets"] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

const DEFAULT_ANALYTICS_TAB: AnalyticsTab = "overview";

export const ANALYTICS_TAB_LABELS: Record<AnalyticsTab, string> = {
  overview: "Overview",
  revenue: "Revenue",
  customers: "Customers",
  inventory: "Inventory",
  targets: "Targets",
};

/** The API section a tab reads. The targets tab reads the monthly target report instead of the analytics request. */
export const ANALYTICS_TAB_SECTION: Record<AnalyticsTab, AnalyticsSection | undefined> = {
  overview: "overview",
  revenue: "revenue",
  customers: "customers",
  inventory: "inventory",
  targets: undefined,
};

const isAnalyticsTab = (value: string): value is AnalyticsTab => (ANALYTICS_TABS as readonly string[]).includes(value);

/** The tab a `?tab=` value names; an unknown value falls back to the default tab. */
export const analyticsTab = (value: string): AnalyticsTab => (isAnalyticsTab(value) ? value : DEFAULT_ANALYTICS_TAB);

/** The `?tab=` value a tab group label stands for, for `SubTabs`' change handler. */
export const analyticsTabOfLabel = (label: string): AnalyticsTab =>
  ANALYTICS_TABS.find((tab) => ANALYTICS_TAB_LABELS[tab] === label) ?? DEFAULT_ANALYTICS_TAB;
