/**
 * Pure data shaping for the Targets chart: each site's revenue next to its target. A site without a target has no target
 * bar (null), never a zero one. No React imports, so node can test them.
 */
import type { SalesTargetSiteRow } from "./contract.ts";
import { barValue, type ChartRow } from "./inventory-chart.ts";

/**
 * One row per site, the site with the most revenue first. With `withTarget` each row carries [revenue, target]; without
 * it, [revenue] alone, for a month in which no site has a target.
 */
export const targetsChartRows = (rows: readonly SalesTargetSiteRow[], withTarget: boolean): ChartRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.revenue ?? 0) - (a.row.revenue ?? 0) || a.index - b.index)
    .map(({ row }) => ({
      key: row.siteId,
      label: row.siteName,
      values: withTarget ? [barValue(row.revenue), barValue(row.target)] : [barValue(row.revenue)],
    }));
