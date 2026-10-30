import type { AnalyticsChannel } from "./contract.ts";

export const ANALYTICS_QUERY_KEY = ["staff-analytics"] as const;
export const SALES_TARGETS_QUERY_KEY = ["sales-targets"] as const;

export const ANALYTICS_CHANNELS = ["all", "counter", "online"] as const satisfies readonly AnalyticsChannel[];

export const isAnalyticsChannel = (value: string): value is AnalyticsChannel =>
  (ANALYTICS_CHANNELS as readonly string[]).includes(value);

/** The `GET /api/dashboard/analytics` path for API bounds (`from` inclusive, `to` exclusive) and the filters. */
export const analyticsPath = (
  bounds: { from: string; to: string },
  siteId: string | undefined,
  channel: AnalyticsChannel,
): string => {
  const params = new URLSearchParams({ from: bounds.from, to: bounds.to, channel });
  if (siteId) params.set("siteId", siteId);
  return `/api/dashboard/analytics?${params.toString()}`;
};

/** The `GET /api/dashboard/sales-targets` path: the month's target rows and its API bounds for the revenue. */
export const salesTargetsPath = (
  bounds: { from: string; to: string },
  siteId: string | undefined,
  month: string,
): string => {
  const params = new URLSearchParams({ month, from: bounds.from, to: bounds.to });
  if (siteId) params.set("siteId", siteId);
  return `/api/dashboard/sales-targets?${params.toString()}`;
};
