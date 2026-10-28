import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  Alert,
  Button,
  DataTable,
  Field,
  Input,
  Select,
  Skeleton,
  StatTile,
  ToggleGroup,
  ToggleGroupItem,
} from "@pharmacy/ui";

import { dataTableLabels } from "../components/data-table-labels.ts";
import { RefreshButton } from "../components/forms.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { translateText } from "../i18n.ts";
import { useCan } from "../permissions/use-can.ts";
import { formatDateTime, readOne, text } from "../staff-api.ts";
import { CreatePlanDrawer } from "./action-plans/create-plan-drawer.tsx";
import { deadStockDraft, type ActionPlanDraft } from "./action-plans/drafts.ts";
import { labelOrShortId } from "./inventory/format.ts";
import type {
  AnalyticsChannel,
  AnalyticsResponse,
  DeadStockItem,
  ExpiryBucket,
  Figure,
  FigurePair,
  SalesChannel,
} from "./analytics/contract.ts";
import { formatCount, formatMoney, formatPercentChange, formatRate, percentChange } from "./analytics/figures.ts";
import {
  firstDayOf,
  formatDayLabel,
  isPeriodPreset,
  lastDayBefore,
  periodBounds,
  periodRangeError,
  presetRange,
  type DayRange,
  type PeriodPreset,
  type PeriodRangeError,
} from "./analytics/period.ts";
import { ANALYTICS_CHANNELS, ANALYTICS_QUERY_KEY, analyticsPath, isAnalyticsChannel } from "./analytics/query.ts";
import { moneyLocale } from "./sales/shared.tsx";

const LIST_DEFAULTS = { period: "30d", from: "", to: "", site: "all", channel: "all" } as const;
const NO_BOUNDS = { from: "", to: "" };

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  month: "This month",
  custom: "Custom",
};

const CHANNEL_LABELS: Record<AnalyticsChannel, string> = { all: "All", counter: "Counter", online: "Online" };

const RANGE_MESSAGES: Record<PeriodRangeError, string> = {
  missing: "Choose both dates.",
  invalid: "The date is not valid.",
  order: "The start date must be on or before the end date.",
  tooLong: "A period can be at most 365 days.",
};

const SALES_CHANNELS: readonly SalesChannel[] = ["counter", "online"];
const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = { counter: "Counter", online: "Online" };

type ExpiryKey = keyof AnalyticsResponse["inventory"]["expiry"];
const EXPIRY_GROUPS: ReadonlyArray<{ key: ExpiryKey; label: string }> = [
  { key: "expired", label: "Expired" },
  { key: "within30", label: "Within 30 days" },
  { key: "within60", label: "31 to 60 days" },
  { key: "within90", label: "61 to 90 days" },
];

type ChannelRow = { channel: SalesChannel; revenue: Figure; orderCount: Figure };
type ExpiryRow = { key: ExpiryKey; label: string; bucket: ExpiryBucket | undefined };
type SiteStockRow = AnalyticsResponse["inventory"]["stockValue"]["bySite"][number];
type DeadStockRow = DeadStockItem & { site: string };

const Heading = ({ children }: { children: string }): React.JSX.Element => (
  <h2 className="text-sm font-semibold text-ink">{translateText(children)}</h2>
);

const KpiTile = ({
  label,
  pair,
  format,
  locale,
  note,
}: {
  label: string;
  pair: FigurePair | undefined;
  format: (value: unknown) => string;
  locale: string;
  note?: string | undefined;
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
        </span>
      )
    }
  />
);

export const AnalyticsSection = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const references = useStaffReferences();
  const locale = moneyLocale();

  const period: PeriodPreset = isPeriodPreset(list.values.period) ? list.values.period : "30d";
  const range: DayRange =
    period === "custom" ? { fromDay: list.values.from, toDay: list.values.to } : presetRange(period, new Date());
  const rangeError = periodRangeError(range);
  const bounds = rangeError === undefined ? periodBounds(range) : NO_BOUNDS;

  const siteOptions = referenceOptions(references.sites, ["code", "name"]);
  // A site the URL names that the staff member may not see is dropped. While the site list loads, the URL value is sent
  // and the server answers for it.
  const siteKnown = siteOptions.length === 0 || siteOptions.some((option) => option.value === list.values.site);
  const siteId = siteKnown ? list.values.site : "all";
  const siteFilter = siteId === "all" ? undefined : siteId;
  const channel: AnalyticsChannel = isAnalyticsChannel(list.values.channel) ? list.values.channel : "all";

  const analyticsQuery = useQuery({
    queryKey: [...ANALYTICS_QUERY_KEY, bounds.from, bounds.to, siteFilter ?? "all", channel],
    queryFn: () => readOne<AnalyticsResponse>(analyticsPath(bounds, siteFilter, channel)),
    enabled: rangeError === undefined,
  });

  // After a failed request no figure from an earlier answer stays on screen: every figure reads "—" beside the alert.
  const data = analyticsQuery.isError ? undefined : analyticsQuery.data;
  const loading = rangeError === undefined && analyticsQuery.isPending;
  const error =
    analyticsQuery.isError && analyticsQuery.error instanceof Error ? analyticsQuery.error.message : undefined;
  const currency = text(data?.currency, "VND");
  const money = (value: unknown): string => formatMoney(value, currency, locale);
  const count = (value: unknown): string => formatCount(value, locale);
  const inventory = data?.inventory;
  const grossProfit = data?.kpis?.grossProfit;
  const planGate = useCan("actionPlan.create");
  const [planDraft, setPlanDraft] = useState<ActionPlanDraft>();
  const deadStockDays = inventory?.deadStock?.deadStockDays;

  const selectPeriod = (next: PeriodPreset): void => {
    if (next === "custom") {
      list.setValues({ period: next, from: range.fromDay, to: range.toDay }, { history: "push" });
      return;
    }
    list.setValues({ period: next, from: "", to: "" }, { history: "push" });
  };

  const channelRows: ChannelRow[] = SALES_CHANNELS.map((salesChannel) => {
    const row = data?.channels?.find((item) => item.channel === salesChannel);
    // A missing channel or figure stays null ("—"); it is never filled with 0.
    return { channel: salesChannel, revenue: row?.revenue ?? null, orderCount: row?.orderCount ?? null };
  });
  const expiryRows: ExpiryRow[] = EXPIRY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    bucket: inventory?.expiry?.[group.key],
  }));
  const siteStockRows: SiteStockRow[] = inventory?.stockValue?.bySite ?? [];
  const deadStockRows: DeadStockRow[] = (inventory?.deadStock?.items ?? []).map((item) => ({
    ...item,
    site: labelOrShortId(referenceLabel(references.sites, item.siteId, ["code", "name"]), item.siteId),
  }));

  const currentDays =
    rangeError === undefined ? `${formatDayLabel(range.fromDay, locale)} – ${formatDayLabel(range.toDay, locale)}` : "";
  const previousDays =
    data?.previousPeriod === undefined
      ? ""
      : `${formatDayLabel(firstDayOf(data.previousPeriod.from), locale)} – ${formatDayLabel(lastDayBefore(data.previousPeriod.to), locale)}`;

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted">
        {translateText(
          "Revenue, orders and stock health for the chosen period, site and channel. Revenue counts paid invoices.",
        )}{" "}
        {translateText("A dash (—) means the figure could not be answered, not zero.")}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{translateText("Period")}</span>
          <ToggleGroup<PeriodPreset> aria-label={translateText("Period")} value={period} onValueChange={selectPeriod}>
            {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((preset) => (
              <ToggleGroupItem key={preset} value={preset}>
                {translateText(PERIOD_LABELS[preset])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="w-44">
          <Field label={translateText("Site")}>
            <Select
              value={siteId}
              onChange={(event) => list.setValues({ site: event.target.value }, { history: "push" })}
            >
              <option value="all">{translateText("All sites")}</option>
              {siteOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-ink">{translateText("Channel")}</span>
          <ToggleGroup<AnalyticsChannel>
            aria-label={translateText("Channel")}
            value={channel}
            onValueChange={(next) => list.setValues({ channel: next }, { history: "push" })}
          >
            {ANALYTICS_CHANNELS.map((item) => (
              <ToggleGroupItem key={item} value={item}>
                {translateText(CHANNEL_LABELS[item])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <RefreshButton onClick={() => void analyticsQuery.refetch()} />
      </div>

      {period === "custom" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Field label={translateText("From")}>
              <Input
                type="date"
                value={list.values.from}
                onChange={(event) => list.setValues({ from: event.target.value }, { history: "replace" })}
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label={translateText("To")}>
              <Input
                type="date"
                value={list.values.to}
                onChange={(event) => list.setValues({ to: event.target.value }, { history: "replace" })}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {rangeError ? <Alert variant="warning">{translateText(RANGE_MESSAGES[rangeError])}</Alert> : null}
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
      {data ? (
        <p className="text-xs text-muted">
          {translateText("Current period")}: {currentDays}
          {previousDays ? ` · ${translateText("Previous period")}: ${previousDays}` : null} ·{" "}
          {translateText("Updated at")} {formatDateTime(data.generatedAt)}
        </p>
      ) : null}

      <section className="grid gap-2">
        <Heading>Revenue and orders</Heading>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {loading ? (
            ["Revenue", "Orders", "Average order value", "Gross profit"].map((label) => (
              <Skeleton key={label} className="h-[98px]" />
            ))
          ) : (
            <>
              <KpiTile label="Revenue" pair={data?.kpis?.revenue} format={money} locale={locale} />
              <KpiTile label="Orders" pair={data?.kpis?.orderCount} format={count} locale={locale} />
              <KpiTile
                label="Average order value"
                pair={data?.kpis?.averageOrderValue}
                format={money}
                locale={locale}
              />
              <KpiTile
                label="Gross profit"
                pair={grossProfit}
                format={money}
                locale={locale}
                {...(grossProfit && grossProfit.available === false
                  ? {
                      note: translateText("No purchase cost is recorded, so gross profit cannot be calculated."),
                    }
                  : {})}
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
            { key: "revenue", label: translateText("Revenue"), align: "right", render: (row) => money(row.revenue) },
            {
              key: "orderCount",
              label: translateText("Orders"),
              align: "right",
              render: (row) => count(row.orderCount),
            },
          ]}
        />
        <p className="text-xs text-muted">
          {translateText(
            "The channel filter does not apply to this table: both channels show for the chosen site and period.",
          )}
        </p>
      </section>

      <section className="grid gap-2">
        <Heading>Inventory health</Heading>
        <p className="text-xs text-muted">
          {translateText(
            "The channel does not change inventory figures. Turnover and days of inventory cover the chosen period; stockout rate, dead stock and expiry are the current state.",
          )}
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {loading ? (
            Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-[98px]" />)
          ) : (
            <>
              <StatTile
                label={translateText("Inventory turnover")}
                value={count(inventory?.turnover)}
                hint={translateText("In the period")}
              />
              <StatTile
                label={translateText("Days of inventory")}
                value={count(inventory?.daysOfInventory)}
                hint={translateText("Period days divided by turnover")}
              />
              <StatTile
                label={translateText("Stockout rate")}
                value={formatRate(inventory?.stockoutRate, locale)}
                hint={
                  <span className="grid gap-0.5">
                    <span>{translateText("Now")}</span>
                    <span>
                      {translateText("Out of stock now")}: {count(inventory?.outOfStockProductCount)} /{" "}
                      {count(inventory?.stockedProductCount)}
                    </span>
                  </span>
                }
              />
              <StatTile
                label={translateText("Dead stock")}
                value={count(inventory?.deadStock?.productCount)}
                hint={
                  <span>
                    {translateText("No movement in the last")} {count(inventory?.deadStock?.deadStockDays)}{" "}
                    {translateText("days")}
                  </span>
                }
              />
              <StatTile
                label={translateText("Dead stock quantity")}
                value={count(inventory?.deadStock?.quantity)}
                hint={translateText("Now")}
              />
              <StatTile
                label={translateText("Dead stock value")}
                value={money(inventory?.deadStock?.value)}
                hint={translateText("Now")}
              />
              <StatTile
                label={translateText("Total stock value")}
                value={money(inventory?.stockValue?.total)}
                hint={
                  <span>
                    {translateText("Products without a published price")}:{" "}
                    {count(inventory?.stockValue?.missingPriceCount)}
                  </span>
                }
              />
            </>
          )}
        </div>
      </section>

      <section className="grid gap-2">
        <Heading>Stock value by site</Heading>
        <DataTable<SiteStockRow>
          storageKey="staff:analytics:stock-by-site"
          labels={dataTableLabels()}
          loading={loading}
          rows={siteStockRows}
          getKey={(row) => row.siteId}
          empty={translateText("No records found")}
          columns={[
            { key: "siteName", label: translateText("Site"), render: (row) => text(row.siteName) },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => count(row.quantity),
            },
            { key: "value", label: translateText("Value"), align: "right", render: (row) => money(row.value) },
          ]}
        />
      </section>

      <section className="grid gap-2">
        <Heading>Expiring in 30 / 60 / 90 days</Heading>
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
              label: translateText("Products"),
              align: "right",
              render: (row) => count(row.bucket?.productCount),
            },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => count(row.bucket?.quantity),
            },
            {
              key: "value",
              label: translateText("Value"),
              align: "right",
              render: (row) => money(row.bucket?.value),
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
          columns={[
            { key: "productName", label: translateText("Product"), truncate: 32 },
            { key: "site", label: translateText("Site") },
            {
              key: "quantity",
              label: translateText("Quantity"),
              align: "right",
              render: (row) => count(row.quantity),
            },
            { key: "value", label: translateText("Value"), align: "right", render: (row) => money(row.value) },
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
          ]}
        />
      </section>
      {planDraft ? <CreatePlanDrawer draft={planDraft} onClose={() => setPlanDraft(undefined)} /> : null}
    </div>
  );
};
