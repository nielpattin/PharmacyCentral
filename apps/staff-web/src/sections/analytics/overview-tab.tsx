import { DataTable, Skeleton, StatTile } from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { translateText } from "../../i18n.ts";
import { fillText } from "../procurement/bulk-summary.ts";
import type { AnalyticsOverviewResponse, Figure, FigurePair, SalesChannel } from "./contract.ts";
import { formatPercentChange, partialCoveragePercent, percentChange } from "./figures.ts";
import { Heading, type FigureFormat } from "./shared.tsx";

const SALES_CHANNELS: readonly SalesChannel[] = ["counter", "online"];
const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = { counter: "Counter", online: "Online" };

type ChannelRow = { channel: SalesChannel; revenue: Figure; orderCount: Figure };

const KpiTile = ({
  label,
  pair,
  format,
  locale,
  note,
  footnote,
}: {
  label: string;
  pair: FigurePair | undefined;
  format: (value: unknown) => string;
  locale: string;
  /** Replaces the comparison, for a figure that has none to show. */
  note?: string | undefined;
  /** Added under the comparison. */
  footnote?: string | undefined;
}): React.JSX.Element => (
  <StatTile
    label={translateText(label)}
    value={format(pair?.current)}
    hint={
      note ? (
        <span className="text-xs text-muted">{note}</span>
      ) : (
        <span className="grid gap-0.5">
          <span>
            {translateText("Previous period")}: {format(pair?.previous)}
          </span>
          <span>
            {translateText("Change")}: {formatPercentChange(percentChange(pair?.current, pair?.previous), locale)}
          </span>
          {footnote ? <span className="text-muted">{footnote}</span> : null}
        </span>
      )
    }
  />
);

/** The period at a glance: the KPIs against the previous period, and the two channels side by side. */
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
  // A missing channel or figure stays null ("—"); it is never filled with 0.
  const channelRows: ChannelRow[] = SALES_CHANNELS.map((channel) => {
    const row = data?.channels.find((item) => item.channel === channel);
    return { channel, revenue: row?.revenue ?? null, orderCount: row?.orderCount ?? null };
  });

  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <Heading>Revenue and orders</Heading>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {loading ? (
            ["Revenue", "Orders", "Average order value", "Gross profit"].map((label) => (
              <Skeleton key={label} className="h-[98px]" />
            ))
          ) : (
            <>
              <KpiTile label="Revenue" pair={data?.kpis.revenue} format={format.money} locale={locale} />
              <KpiTile label="Orders" pair={data?.kpis.orderCount} format={format.count} locale={locale} />
              <KpiTile
                label="Average order value"
                pair={data?.kpis.averageOrderValue}
                format={format.money}
                locale={locale}
              />
              <KpiTile
                label="Gross profit"
                pair={grossProfit}
                format={format.money}
                locale={locale}
                {...(grossProfit && grossProfit.available === false
                  ? {
                      note: translateText(
                        "No purchase cost is recorded for the sales of this period. Enter the unit cost on the goods receipt.",
                      ),
                    }
                  : {})}
                {...(grossProfitCoverage === null
                  ? {}
                  : {
                      footnote: fillText(translateText("Based on {percent}% of revenue that has a recorded cost."), {
                        percent: grossProfitCoverage,
                      }),
                    })}
              />
            </>
          )}
        </div>
      </section>

      <section className="grid gap-2">
        <Heading>Revenue by channel</Heading>
        <DataTable<ChannelRow>
          storageKey="staff:analytics:channels"
          labels={dataTableLabels()}
          loading={loading}
          rows={channelRows}
          getKey={(row) => row.channel}
          empty={translateText("No records found")}
          columns={[
            {
              key: "channel",
              label: translateText("Channel"),
              render: (row) => translateText(SALES_CHANNEL_LABELS[row.channel]),
            },
            {
              key: "revenue",
              label: translateText("Revenue"),
              align: "right",
              render: (row) => format.money(row.revenue),
            },
            {
              key: "orderCount",
              label: translateText("Orders"),
              align: "right",
              render: (row) => format.count(row.orderCount),
            },
          ]}
        />
        <p className="text-xs text-muted">
          {translateText(
            "The channel filter does not apply to this table: both channels show for the chosen site and period.",
          )}
        </p>
      </section>
    </div>
  );
};
