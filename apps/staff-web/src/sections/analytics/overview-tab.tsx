import { AreaTrend, Card, CardContent, CardHeader, CardTitle, DonutChart, Skeleton, StatTile } from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import { Change } from "../dashboard/shared.tsx";
import { fillText } from "../procurement/bulk-summary.ts";
import type { AnalyticsOverviewResponse, Figure, SalesChannel } from "./contract.ts";
import { partValue } from "./customers-split.ts";
import { formatRate, isAnswered, partialCoveragePercent } from "./figures.ts";
import { compactMoney, comparedSeries, formatDay, hasNoDays } from "./overview-series.ts";
import { type FigureFormat } from "./shared.tsx";

const SALES_CHANNELS: readonly SalesChannel[] = ["counter", "online"];
const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = { counter: "Counter", online: "Online" };

type ChannelRow = { channel: SalesChannel; revenue: Figure; orderCount: Figure };

/** The period at a glance: the KPIs against the previous period, the days as lines, and the two channels as a ring. */
export const OverviewTab = ({
  data,
  loading,
  locale,
  format,
}: {
  data: AnalyticsOverviewResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
}): React.JSX.Element => {
  const grossProfit = data?.kpis.grossProfit;
  const grossProfitCoverage = grossProfit?.available ? partialCoveragePercent(grossProfit.coverage?.current) : null;
  const currency = data?.currency ?? "VND";
  const days = data?.series ?? { current: [], previous: [] };
  const periodLabels = { current: translateText("Current period"), previous: translateText("Previous period") };
  const empty = translateText("No records found");
  // A missing channel or figure stays null ("—"); it is never filled with 0.
  const channelRows: ChannelRow[] = SALES_CHANNELS.map((channel) => {
    const row = data?.channels.find((item) => item.channel === channel);
    return { channel, revenue: row?.revenue ?? null, orderCount: row?.orderCount ?? null };
  });
  const channelTotal = channelRows.reduce<number | null>(
    (sum, row) => (sum === null || !isAnswered(row.revenue) ? null : sum + row.revenue),
    0,
  );

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
          <Skeleton className="h-40 lg:row-span-2 lg:h-auto" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28 lg:col-span-2" />
        </div>
        <Skeleton className="h-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
        <StatTile
          featured
          className="lg:row-span-2"
          label={translateText("Revenue")}
          value={format.money(data?.kpis.revenue.current)}
          hint={<Change pair={data?.kpis.revenue} format={format.money} locale={locale} />}
        />
        <StatTile
          label={translateText("Orders")}
          value={format.count(data?.kpis.orderCount.current)}
          hint={<Change pair={data?.kpis.orderCount} format={format.count} locale={locale} />}
        />
        <StatTile
          label={translateText("Average order value")}
          value={format.money(data?.kpis.averageOrderValue.current)}
          hint={<Change pair={data?.kpis.averageOrderValue} format={format.money} locale={locale} />}
        />
        <StatTile
          className="lg:col-span-2"
          label={translateText("Gross profit")}
          value={format.money(grossProfit?.current)}
          hint={
            grossProfit && grossProfit.available === false ? (
              translateText(
                "No purchase cost is recorded for the sales of this period. Enter the unit cost on the goods receipt.",
              )
            ) : (
              <span className="grid gap-0.5">
                <Change pair={grossProfit} format={format.money} locale={locale} />
                {grossProfitCoverage === null ? null : (
                  <span>
                    {fillText(translateText("Based on {percent}% of revenue that has a recorded cost."), {
                      percent: grossProfitCoverage,
                    })}
                  </span>
                )}
              </span>
            )
          }
        />
      </div>

      <Card variant="soft">
        <CardHeader>
          <CardTitle>{translateText("Revenue by day")}</CardTitle>
        </CardHeader>
        <CardContent>
          {hasNoDays(days) ? (
            <p className="py-6 text-sm text-muted">{empty}</p>
          ) : (
            <AreaTrend
              height={280}
              series={comparedSeries(days, "revenue", periodLabels)}
              formatValue={(value) => compactMoney(value, currency, locale)}
              formatTime={(unixSeconds) => formatDay(unixSeconds, locale)}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("Orders by day")}</CardTitle>
          </CardHeader>
          <CardContent>
            {hasNoDays(days) ? (
              <p className="py-6 text-sm text-muted">{empty}</p>
            ) : (
              <AreaTrend
                height={220}
                series={comparedSeries(days, "orders", periodLabels)}
                formatValue={(value) => format.count(value)}
                formatTime={(unixSeconds) => formatDay(unixSeconds, locale)}
              />
            )}
          </CardContent>
        </Card>

        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("Revenue by channel")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <DonutChart
              empty={empty}
              formatShare={(fraction) => formatRate(fraction, locale)}
              centre={{ label: translateText("Revenue"), value: format.money(channelTotal) }}
              parts={channelRows.map((row) => ({
                key: row.channel,
                label: `${translateText(SALES_CHANNEL_LABELS[row.channel])} · ${translateText("Orders")}: ${format.count(row.orderCount)}`,
                value: partValue(row.revenue),
                display: format.money(row.revenue),
              }))}
            />
            <p className="text-xs text-muted">
              {translateText(
                "The channel filter does not apply to this table: both channels show for the chosen site and period.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
