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
  Skeleton,
  StatTile,
} from "@pharmacy/ui";

import { dataTableLabels } from "../../components/data-table-labels.ts";
import { useRetainedTarget } from "../../hooks/useRetainedTarget.ts";
import { translateText } from "../../i18n.ts";
import { withActionColumn } from "../../lib/action-column.ts";
import { useCan } from "../../permissions/use-can.ts";
import { CreatePlanDrawer } from "../action-plans/create-plan-drawer.tsx";
import { deadStockDraft, type ActionPlanDraft } from "../action-plans/drafts.ts";
import type { AnalyticsInventoryResponse, DeadStockItem, ExpiryBucket, InventoryHealth } from "./contract.ts";
import { fillText } from "../procurement/bulk-summary.ts";
import { formatRate, isAnswered } from "./figures.ts";
import { capChartRows, isCapped, MAX_CHART_BARS } from "./chart-cap.ts";
import { compactNumber, expiryChartRows, siteStockChartRows } from "./inventory-chart.ts";
import { rankByValue } from "./inventory-rows.ts";
import { Heading, type FigureFormat } from "./shared.tsx";

type ExpiryKey = keyof InventoryHealth["expiry"];
type ExpiryRow = { key: ExpiryKey; label: string; bucket: ExpiryBucket | undefined };
type SiteStockRow = InventoryHealth["stockValue"]["bySite"][number];
type DeadStockRow = DeadStockItem & { site: string };

const EXPIRY_GROUPS: ReadonlyArray<{ key: ExpiryKey; label: string }> = [
  { key: "expired", label: "Expired" },
  { key: "within30", label: "Within 30 days" },
  { key: "within60", label: "31 to 60 days" },
  { key: "within90", label: "61 to 90 days" },
];

/** Stock health now and over the period, with the dead stock rows that become action plans. */
export const InventoryTab = ({
  data,
  loading,
  locale,
  format,
  siteLabel,
}: {
  data: AnalyticsInventoryResponse | undefined;
  loading: boolean;
  locale: string;
  format: FigureFormat;
  /** A site's label, for the dead stock rows that name one. */
  siteLabel: (siteId: string) => string;
}): React.JSX.Element => {
  const inventory = data?.inventory;
  const deadStockDays = inventory?.deadStock.deadStockDays;
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();
  const planDrawer = useRetainedTarget(planDraft);

  const expiryRows: ExpiryRow[] = EXPIRY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    bucket: inventory?.expiry[group.key],
  }));
  const siteStockRows: SiteStockRow[] = rankByValue(inventory?.stockValue.bySite ?? []);
  // The chart keeps a fixed height: the first sites, then one merged bar. The full list is a table when the chart cuts it.
  const siteStockBars = capChartRows(siteStockChartRows(siteStockRows), MAX_CHART_BARS, translateText("Other"));
  const siteStockCapped = isCapped(siteStockRows.length, MAX_CHART_BARS);
  const deadStockRows: DeadStockRow[] = (inventory?.deadStock.items ?? []).map((item) => ({
    ...item,
    site: siteLabel(item.siteId),
  }));

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <Heading>Inventory health</Heading>
        <p className="text-xs text-muted">
          {translateText(
            "The channel does not change inventory figures. Turnover and days of inventory cover the chosen period; stockout rate, dead stock and expiry are the current state.",
          )}
        </p>
        {loading ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-40 rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-28 rounded-2xl" />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                featured
                label={translateText("Total stock value")}
                value={format.money(inventory?.stockValue.total)}
                hint={
                  <span>
                    {translateText("Products without a published price")}:{" "}
                    {format.count(inventory?.stockValue.missingPriceCount)}
                  </span>
                }
              />
              <StatTile
                featured
                tone={isAnswered(inventory?.stockoutRate) && inventory.stockoutRate > 0 ? "warning" : undefined}
                label={translateText("Stockout rate")}
                value={formatRate(inventory?.stockoutRate, locale)}
                hint={
                  <span className="grid gap-0.5">
                    <span>{translateText("Now")}</span>
                    <span>
                      {translateText("Out of stock now")}: {format.count(inventory?.outOfStockProductCount)} /{" "}
                      {format.count(inventory?.stockedProductCount)}
                    </span>
                  </span>
                }
              />
              <StatTile
                featured
                label={translateText("Dead stock value")}
                value={format.money(inventory?.deadStock.value)}
                hint={translateText("Now")}
              />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              <StatTile
                label={translateText("Inventory turnover")}
                value={format.count(inventory?.turnover)}
                hint={translateText("In the period")}
              />
              <StatTile
                label={translateText("Days of inventory")}
                value={format.count(inventory?.daysOfInventory)}
                hint={translateText("Period days divided by turnover")}
              />
              <StatTile
                label={translateText("Dead stock")}
                value={format.count(inventory?.deadStock.productCount)}
                hint={
                  <span>
                    {translateText("No movement in the last")} {format.count(inventory?.deadStock.deadStockDays)}{" "}
                    {translateText("days")}
                  </span>
                }
              />
              <StatTile
                label={translateText("Dead stock quantity")}
                value={format.count(inventory?.deadStock.quantity)}
                hint={translateText("Now")}
              />
            </div>
          </div>
        )}
      </section>

      <div className="grid items-start gap-3">
        <Card variant="soft">
          <CardHeader>
            <CardTitle>{translateText("Stock value by site")}</CardTitle>
            <p className="text-xs text-muted">
              {translateText(
                "Stock on hand today at each site, largest value first. Value is quantity times the published price.",
              )}
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <BarChartCompare
                  layout="horizontal"
                  height={Math.max(160, siteStockBars.length * 56 + 40)}
                  data={siteStockBars}
                  series={[{ label: translateText("Stock value by site"), tone: "chart-1" }]}
                  formatValue={(value) => compactNumber(value, locale)}
                />
                {siteStockCapped ? (
                  <div className="mt-4">
                    <DataTable<SiteStockRow>
                      interactive
                      stickyHeader={false}
                      storageKey="staff:analytics:stock-by-site"
                      labels={dataTableLabels()}
                      loading={loading}
                      rows={siteStockRows}
                      getKey={(row) => row.siteId}
                      empty={translateText("No records found")}
                      columns={[
                        { key: "siteName", label: translateText("Site") },
                        {
                          key: "value",
                          label: translateText("Value"),
                          align: "right",
                          render: (row) => format.money(row.value),
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3">
        <Heading>Expiring stock</Heading>
        <p className="text-xs text-muted">
          {translateText(
            "Stock on hand today, grouped by the days left to each batch's expiry date. Value is quantity times the published price. Expired batches are still in the warehouse and cannot be sold.",
          )}
        </p>
        {loading ? (
          <Skeleton className="h-32" />
        ) : (
          <BarChartCompare
            height={220}
            data={expiryChartRows(expiryRows.map((row) => ({ ...row, label: translateText(row.label) })))}
            series={[{ label: translateText("Value"), tone: "chart-3" }]}
            formatValue={(value) => compactNumber(value, locale)}
          />
        )}
        <DataTable<ExpiryRow>
          storageKey="staff:analytics:expiry"
          labels={dataTableLabels()}
          loading={loading}
          rows={expiryRows}
          getKey={(row) => row.key}
          empty={translateText("No records found")}
          columns={[
            { key: "label", label: translateText("Expiry group"), render: (row) => translateText(row.label) },
            {
              key: "productCount",
              label: translateText("Product count"),
              align: "right",
              render: (row) => format.count(row.bucket?.productCount),
            },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => format.count(row.bucket?.quantity),
            },
            {
              key: "value",
              label: translateText("Value"),
              align: "right",
              render: (row) => format.money(row.bucket?.value),
            },
          ]}
        />
      </section>

      <section className="grid gap-2">
        <Heading>Dead stock items</Heading>
        <DataTable<DeadStockRow>
          storageKey="staff:analytics:dead-stock"
          labels={dataTableLabels()}
          interactive
          exportCsv={{ filename: "analytics-dead-stock.csv" }}
          loading={loading}
          rows={deadStockRows}
          getKey={(row) => `${row.siteId}:${row.productId}`}
          empty={translateText("No records found")}
          columns={withActionColumn<DataColumn<DeadStockRow>>(
            [
              { key: "productName", label: translateText("Product") },
              { key: "site", label: translateText("Site") },
              {
                key: "quantity",
                label: translateText("Quantity"),
                align: "right",
                render: (row) => format.count(row.quantity),
              },
              {
                key: "value",
                label: translateText("Value"),
                align: "right",
                render: (row) => format.money(row.value),
              },
              {
                key: "actions",
                label: translateText("Actions"),
                pinned: "right",
                enableSorting: false,
                render: (row) =>
                  planGate.allowed && deadStockDays !== undefined ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPlanDraft(
                          deadStockDraft({
                            siteId: row.siteId,
                            productId: row.productId,
                            productName: row.productName,
                            quantity: row.quantity,
                            deadStockDays,
                          }),
                        )
                      }
                    >
                      {translateText("Create plan")}
                    </Button>
                  ) : null,
              },
            ],
            planGate.allowed && deadStockDays !== undefined && deadStockRows.length > 0,
          )}
        />
        {isAnswered(inventory?.deadStock.productCount) && inventory.deadStock.productCount > deadStockRows.length ? (
          <p className="text-xs text-muted">
            {fillText(translateText("Showing {shown} of {total} dead stock products."), {
              shown: format.count(deadStockRows.length),
              total: format.count(inventory.deadStock.productCount),
            })}
          </p>
        ) : null}
      </section>

      {planDrawer ? (
        <CreatePlanDrawer
          key={planDrawer.key}
          open={planDraft !== undefined}
          draft={planDrawer.target}
          onClose={() => setPlanDraft(undefined)}
        />
      ) : null}
    </div>
  );
};
