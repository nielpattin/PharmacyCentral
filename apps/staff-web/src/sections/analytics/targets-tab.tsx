import { useState } from "react";

import {
  BarChartCompare,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataColumn,
  Field,
  Input,
  Skeleton,
  StatTile,
} from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { RefreshButton } from "../../components/forms.tsx";
import { useRetainedTarget } from "../../hooks/useRetainedTarget.ts";
import { translateText } from "../../i18n.ts";
import { withActionColumn } from "../../lib/action-column.ts";
import { useCan } from "../../permissions/use-can.ts";
import type { SalesTargetSiteRow, SalesTargetsResponse } from "./contract.ts";
import { formatRate } from "./figures.ts";
import { Heading, SiteFilter, type FigureFormat } from "./shared.tsx";
import { compactNumber } from "./inventory-chart.ts";
import { capChartRows, MAX_CHART_BARS } from "./chart-cap.ts";
import { targetsChartRows } from "./targets-chart.ts";
import { SalesTargetDialog, type SalesTargetDraft } from "./target-dialog.tsx";

/**
 * The month's paid revenue against each site's goal. The month is its own control: a monthly target cannot ride the
 * page's 7/30/90-day period.
 */
export const TargetsTab = ({
  data,
  loading,
  locale,
  format,
  month,
  onMonthChange,
  siteId,
  siteOptions,
  onSiteChange,
  onRefresh,
}: {
  data: SalesTargetsResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
  /** The "YYYY-MM" month the report covers. */
  month: string;
  onMonthChange: (month: string) => void;
  siteId: string;
  siteOptions: Array<{ value: string; label: string }>;
  onSiteChange: (siteId: string) => void;
  /** Reads the month's target report again. */
  onRefresh: () => void;
}): React.JSX.Element => {
  const targetGate = useCan("salesTarget.set");
  const [targetDraft, setTargetDraft] = useState<SalesTargetDraft>();
  const targetDrawer = useRetainedTarget(targetDraft);
  const rows: SalesTargetSiteRow[] = data?.sites ?? [];
  const totals = data?.totals;
  const hasTargets = rows.some((row) => row.target !== null);
  // The chart keeps a fixed height: the first sites, then one merged bar. The table under it lists every site.
  const targetBars = capChartRows(targetsChartRows(rows, hasTargets), MAX_CHART_BARS, translateText("Other"));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <Heading>Sales targets</Heading>
          <p className="text-xs text-muted">
            {translateText(
              "The month's paid revenue against each site's target, all channels. A target is set by a Pharmacy Manager.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label={translateText("Month")}>
              <Input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} />
            </Field>
          </div>
          <SiteFilter value={siteId} options={siteOptions} onChange={onSiteChange} />
          <RefreshButton onClick={onRefresh} />
        </div>
      </div>
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={hasTargets ? "grid gap-3 sm:grid-cols-3" : "grid gap-3"}>
          {hasTargets ? (
            <StatTile
              featured
              label={`${translateText("Total")}: ${translateText("Progress")}`}
              value={formatRate(totals?.progress, locale)}
            />
          ) : null}
          <StatTile
            featured
            label={`${translateText("Total")}: ${translateText("Revenue")}`}
            value={format.money(totals?.revenue)}
          />
          {hasTargets ? (
            <StatTile
              featured
              label={`${translateText("Total")}: ${translateText("Target")}`}
              value={format.money(totals?.target)}
            />
          ) : null}
        </div>
      )}
      <Card variant="soft">
        <CardHeader>
          <CardTitle>
            {hasTargets ? `${translateText("Revenue")} / ${translateText("Target")}` : translateText("Revenue")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32" />
          ) : (
            <BarChartCompare
              layout="horizontal"
              height={Math.max(160, targetBars.length * (hasTargets ? 64 : 44) + 40)}
              data={targetBars}
              series={
                hasTargets
                  ? [
                      { label: translateText("Revenue"), tone: "chart-1" },
                      { label: translateText("Target"), tone: "chart-2" },
                    ]
                  : [{ label: translateText("Revenue"), tone: "chart-1" }]
              }
              formatValue={(value) => compactNumber(value, locale)}
            />
          )}
        </CardContent>
      </Card>
      <DataTable<SalesTargetSiteRow>
        storageKey="staff:analytics:sales-targets"
        labels={dataTableLabels()}
        interactive
        exportCsv={{ filename: "analytics-sales-targets.csv" }}
        loading={loading}
        rows={rows}
        getKey={(row) => row.siteId}
        empty={translateText("No records found")}
        columns={withActionColumn<DataColumn<SalesTargetSiteRow>>(
          [
            { key: "siteName", label: translateText("Site") },
            {
              key: "target",
              label: translateText("Target"),
              align: "right",
              render: (row) => (row.target === null ? translateText("Not set") : format.money(row.target)),
            },
            {
              key: "revenue",
              label: translateText("Revenue"),
              align: "right",
              render: (row) => format.money(row.revenue),
            },
            {
              key: "progress",
              label: translateText("Progress"),
              align: "right",
              render: (row) => (row.target === null ? translateText("Not set") : formatRate(row.progress, locale)),
            },
            {
              key: "actions",
              label: translateText("Actions"),
              pinned: "right",
              enableSorting: false,
              render: (row) => (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setTargetDraft({
                      siteId: row.siteId,
                      siteName: row.siteName,
                      month,
                      amount: row.target,
                    })
                  }
                >
                  {translateText(row.target === null ? "Set target" : "Change target")}
                </Button>
              ),
            },
          ],
          targetGate.allowed && rows.length > 0,
        )}
      />
      {targetDrawer ? (
        <SalesTargetDialog
          key={targetDrawer.key}
          open={targetDraft !== undefined}
          draft={targetDrawer.target}
          onClose={() => setTargetDraft(undefined)}
        />
      ) : null}
    </div>
  );
};
