import { useQuery } from "@tanstack/react-query";

import { Alert, Card, Disclosure, Input, Field, ToggleGroup, ToggleGroupItem } from "@pharmacy/ui";

import { RefreshButton, SubTabs } from "../components/forms.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { referenceLabel, referenceOptions, useStaffReferences } from "../hooks/useStaffReferences.ts";
import { translateText } from "../i18n.ts";
import { formatDateTime, readOne, text } from "../staff-api.ts";
import type { AnalyticsChannel, AnalyticsResponse, SalesTargetsResponse } from "./analytics/contract.ts";
import { CustomersTab } from "./analytics/customers-tab.tsx";
import { headerSummary } from "./analytics/header-summary.ts";
import { InventoryTab } from "./analytics/inventory-tab.tsx";
import { OverviewTab } from "./analytics/overview-tab.tsx";
import {
  firstDayOf,
  formatDayLabel,
  isPeriodPreset,
  lastDayBefore,
  monthOf,
  monthRange,
  periodBounds,
  periodRangeError,
  presetRange,
  type DayRange,
  type PeriodPreset,
  type PeriodRangeError,
} from "./analytics/period.ts";
import {
  ANALYTICS_QUERY_KEY,
  ANALYTICS_CHANNELS,
  SALES_TARGETS_QUERY_KEY,
  analyticsPath,
  isAnalyticsChannel,
  salesTargetsPath,
} from "./analytics/query.ts";
import { RevenueTab } from "./analytics/revenue-tab.tsx";
import { SiteFilter, figureFormat } from "./analytics/shared.tsx";
import {
  ANALYTICS_TABS,
  ANALYTICS_TAB_LABELS,
  ANALYTICS_TAB_SECTION,
  analyticsTab,
  analyticsTabOfLabel,
} from "./analytics/tabs.ts";
import { TargetsTab } from "./analytics/targets-tab.tsx";
import { labelOrShortId } from "./inventory/format.ts";
import { moneyLocale } from "./sales/shared.tsx";

const LIST_DEFAULTS = {
  tab: "overview",
  period: "30d",
  from: "",
  to: "",
  site: "all",
  channel: "all",
  month: "",
} as const;
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

/**
 * Period analytics as an ERP-style workspace: one tab per question, each tab one request. Only the active tab is
 * mounted and only its request runs, so opening the page reads the period's KPIs, not the whole report.
 *
 * The tab and every filter live in the URL (`?tab=`, `?period=`, `?site=`, `?channel=`, `?month=`), so refresh, a deep
 * link and Back restore the same view. The targets tab keeps its own month: a monthly goal cannot ride the page's
 * 7/30/90-day period.
 */
export const AnalyticsSection = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const references = useStaffReferences();
  const locale = moneyLocale();

  const tab = analyticsTab(list.values.tab);
  const section = ANALYTICS_TAB_SECTION[tab];

  const period: PeriodPreset = isPeriodPreset(list.values.period) ? list.values.period : "30d";
  const range: DayRange =
    period === "custom" ? { fromDay: list.values.from, toDay: list.values.to } : presetRange(period, new Date());
  const rangeError = periodRangeError(range);
  const bounds = rangeError === undefined ? periodBounds(range) : NO_BOUNDS;

  // Sales figures belong to the sites that sell, and stock to the sites that hold it. The headquarters does neither, so
  // no tab offers it; the warehouse and the hub hold stock but take no sale, so only the inventory tab offers them.
  const siteOptions = referenceOptions(
    references.sites.filter((site) =>
      tab === "inventory" ? site.siteType !== "Headquarters" : site.isCustomerFacing !== false,
    ),
    ["code", "name"],
  );
  // A site the URL names that the staff member may not see is dropped. While the site list loads, the URL value is sent
  // and the server answers for it.
  const siteKnown = siteOptions.length === 0 || siteOptions.some((option) => option.value === list.values.site);
  const siteId = siteKnown ? list.values.site : "all";
  const siteFilter = siteId === "all" ? undefined : siteId;
  const channel: AnalyticsChannel = isAnalyticsChannel(list.values.channel) ? list.values.channel : "all";
  const siteLabel = (value: string): string =>
    labelOrShortId(referenceLabel(references.sites, value, ["code", "name"]), value);

  // One request answers the active tab only. The fallback section never runs: the query is enabled on the four
  // analytics tabs alone, and the targets tab reads its own report below.
  const analyticsQuery = useQuery({
    queryKey: [...ANALYTICS_QUERY_KEY, section ?? "targets", bounds.from, bounds.to, siteFilter ?? "all", channel],
    queryFn: () => readOne<AnalyticsResponse>(analyticsPath(bounds, siteFilter, channel, section ?? "overview")),
    enabled: section !== undefined && rangeError === undefined,
  });

  // The target report has its own month: its revenue is the whole calendar month, all channels, under the page's site
  // filter. It is read only while the targets tab is open.
  const targetMonth =
    list.values.month !== "" && monthRange(list.values.month) ? list.values.month : monthOf(new Date());
  const targetRange = monthRange(targetMonth);
  const targetBounds = targetRange ? periodBounds(targetRange) : NO_BOUNDS;
  const targetsQuery = useQuery({
    queryKey: [...SALES_TARGETS_QUERY_KEY, targetMonth, siteFilter ?? "all"],
    queryFn: () => readOne<SalesTargetsResponse>(salesTargetsPath(targetBounds, siteFilter, targetMonth)),
    enabled: tab === "targets" && targetRange !== undefined,
  });

  // After a failed request no figure from an earlier answer stays on screen: every figure reads "—" beside the alert.
  const data = analyticsQuery.isError ? undefined : analyticsQuery.data;
  const analyticsLoading = section !== undefined && rangeError === undefined && analyticsQuery.isPending;
  const analyticsError =
    analyticsQuery.isError && analyticsQuery.error instanceof Error ? analyticsQuery.error.message : undefined;
  const targetsData = targetsQuery.isError ? undefined : targetsQuery.data;
  const targetsError = targetsQuery.isError
    ? targetsQuery.error instanceof Error
      ? targetsQuery.error.message
      : "The request failed."
    : undefined;
  const activeError = section === undefined ? targetsError : analyticsError;

  // The tab that is open narrows the union to its own block; another section's fields are absent, not empty.
  const overview = data !== undefined && data.section === "overview" ? data : undefined;
  const revenue = data !== undefined && data.section === "revenue" ? data : undefined;
  const customers = data !== undefined && data.section === "customers" ? data : undefined;
  const inventory = data !== undefined && data.section === "inventory" ? data : undefined;
  const figures = figureFormat(text(data?.currency, "VND"), locale);
  const targetFigures = figureFormat(text(targetsData?.currency, "VND"), locale);

  const currentDays =
    rangeError === undefined ? `${formatDayLabel(range.fromDay, locale)} – ${formatDayLabel(range.toDay, locale)}` : "";
  const previousDays =
    data === undefined
      ? ""
      : `${formatDayLabel(firstDayOf(data.previousPeriod.from), locale)} – ${formatDayLabel(lastDayBefore(data.previousPeriod.to), locale)}`;

  const summary = headerSummary({
    current: `${translateText("Current period")}: ${currentDays}`,
    previous: previousDays ? `${translateText("Previous period")}: ${previousDays}` : "",
    updated: data === undefined ? "" : `${translateText("Updated at")} ${formatDateTime(data.generatedAt)}`,
  });

  const selectPeriod = (next: PeriodPreset): void => {
    if (next === "custom") {
      list.setValues({ period: next, from: range.fromDay, to: range.toDay }, { history: "push" });
      return;
    }
    list.setValues({ period: next, from: "", to: "" }, { history: "push" });
  };

  // Refresh reads the open tab again, and nothing the other tabs hold.
  const refresh = (): void => {
    if (section === undefined) {
      void targetsQuery.refetch();
      return;
    }
    // A custom range that does not validate sends no request; the warning beside the filters already says why.
    if (rangeError === undefined) void analyticsQuery.refetch();
  };

  return (
    <div className="grid gap-6">
      <SubTabs
        className="mb-0"
        tabs={ANALYTICS_TABS.map((key) => ANALYTICS_TAB_LABELS[key])}
        active={ANALYTICS_TAB_LABELS[tab]}
        onChange={(label) => list.setValues({ tab: analyticsTabOfLabel(label) }, { history: "push" })}
      />

      {section === undefined ? null : (
        <>
          <Card variant="soft" className="grid gap-4 p-4">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div className="grid gap-1.5">
                <span className="text-sm font-medium text-ink">{translateText("Period")}</span>
                <ToggleGroup<PeriodPreset>
                  aria-label={translateText("Period")}
                  value={period}
                  onValueChange={selectPeriod}
                >
                  {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((preset) => (
                    <ToggleGroupItem key={preset} value={preset}>
                      {translateText(PERIOD_LABELS[preset])}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <SiteFilter
                  value={siteId}
                  options={siteOptions}
                  onChange={(next) => list.setValues({ site: next }, { history: "push" })}
                />
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
                <RefreshButton onClick={refresh} />
              </div>
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

            {rangeError === undefined ? <p className="text-sm text-muted tabular-nums">{summary}</p> : null}
          </Card>

          <Disclosure
            className="-mt-3"
            closedLabel={translateText("How to read these figures")}
            openLabel={translateText("Hide the explanation")}
          >
            <p className="max-w-3xl px-2 text-sm text-muted">
              {translateText(
                "Revenue, orders and stock health for the chosen period, site and channel. Revenue counts paid invoices.",
              )}{" "}
              {translateText("A dash (—) means the figure could not be answered, not zero.")}{" "}
              {translateText("The figures may be up to 30 seconds old.")}
            </p>
          </Disclosure>
        </>
      )}

      {activeError ? <Alert variant="danger">{translateText(activeError)}</Alert> : null}

      {tab === "overview" ? (
        <OverviewTab data={overview} loading={analyticsLoading} locale={locale} format={figures} />
      ) : null}
      {tab === "revenue" ? (
        <RevenueTab data={revenue} loading={analyticsLoading} locale={locale} format={figures} />
      ) : null}
      {tab === "customers" ? (
        <CustomersTab data={customers} loading={analyticsLoading} locale={locale} format={figures} />
      ) : null}
      {tab === "inventory" ? (
        <InventoryTab
          data={inventory}
          loading={analyticsLoading}
          locale={locale}
          format={figures}
          siteLabel={siteLabel}
        />
      ) : null}
      {tab === "targets" ? (
        <TargetsTab
          data={targetsData}
          loading={targetsQuery.isPending}
          locale={locale}
          format={targetFigures}
          month={targetMonth}
          onMonthChange={(next) => list.setValues({ month: next }, { history: "replace" })}
          siteId={siteId}
          siteOptions={siteOptions}
          onSiteChange={(next) => list.setValues({ site: next }, { history: "push" })}
          onRefresh={refresh}
        />
      ) : null}
    </div>
  );
};
