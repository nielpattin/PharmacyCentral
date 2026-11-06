import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";

import {
  ActivityFeed,
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  StatTile,
  type ActivityFeedGroup,
} from "@pharmacy/ui";

import { referenceOptions, useStaffReferences } from "../../hooks/useStaffReferences.ts";
import { translateText } from "../../i18n.ts";
import { canAccessSection } from "../../permissions/section-access.ts";
import { pathForSection } from "../../router.ts";
import { formatDateTime, formatQuantity, readOne, text, type JsonRecord } from "../../staff-api.ts";
import type { AnalyticsOverviewResponse } from "../analytics/contract.ts";
import { formatDayLabel, periodBounds, presetRange } from "../analytics/period.ts";
import { ANALYTICS_QUERY_KEY, analyticsPath } from "../analytics/query.ts";
import { SiteFilter, figureFormat } from "../analytics/shared.tsx";
import { collapseActivity, groupByDay } from "../dashboard-activity.ts";
import { auditActionLabel } from "../governance/audit-query.ts";
import { moneyLocale } from "../sales/shared.tsx";
import { feedShowsAction, operationsTiles, tileWarns, type OperationsPersona } from "./operations-tiles.ts";
import { Change, FEED_ROWS, SectionHeading, dayLabel, figureText, formatRelative } from "./shared.tsx";

/** `a / b` for a pair of counts, or "—" when either one is unanswered. */
const ratioText = (used: unknown, total: unknown): string =>
  figureText(used, formatQuantity) === "—" || figureText(total, formatQuantity) === "—"
    ? "—"
    : `${figureText(used, formatQuantity)} / ${figureText(total, formatQuantity)}`;

export const OperationsView = ({
  roles,
  persona,
}: {
  roles: readonly string[];
  persona: OperationsPersona;
}): React.JSX.Element => {
  const references = useStaffReferences();
  // The site the figures are for. "all" means every site the employee may read; the server narrows it to their own.
  const [site, setSite] = useState("all");
  const siteOptions = referenceOptions(references.sites, ["code", "name"]);
  const siteFilter = site === "all" || !siteOptions.some((option) => option.value === site) ? undefined : site;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-summary", siteFilter ?? "all"],
    queryFn: () =>
      readOne<JsonRecord>(
        siteFilter
          ? `/api/dashboard/summary?${new URLSearchParams({ siteId: siteFilter }).toString()}`
          : "/api/dashboard/summary",
      ),
  });
  const dashboard = dashboardQuery.data;
  const pending = dashboardQuery.isPending;
  const error = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : undefined;

  // The last seven days against the seven before, from the same endpoint as the Analytics page. Only a manager reads
  // it: the query is off for everyone else, so no request is sent and none is refused.
  const showRevenue = persona === "manager" && canAccessSection("analytics", roles);
  const range = presetRange("7d", new Date());
  const bounds = periodBounds(range);
  const salesQuery = useQuery({
    queryKey: [...ANALYTICS_QUERY_KEY, "dashboard", bounds.from, siteFilter ?? "all"],
    queryFn: () => readOne<AnalyticsOverviewResponse>(analyticsPath(bounds, siteFilter, "all", "overview")),
    enabled: showRevenue,
    retry: false,
  });
  const sales = salesQuery.data;
  const revenueShown = showRevenue && !salesQuery.isError;
  // The filter sits in the heading of the first section on the page, so it takes no row of its own.
  const siteFilterControl =
    siteOptions.length > 1 ? <SiteFilter value={siteFilter ?? "all"} options={siteOptions} onChange={setSite} /> : undefined;
  const locale = moneyLocale();
  const figures = figureFormat(text(sales?.currency, "VND"), locale);

  const tiles = operationsTiles(persona);
  const facts: Array<[label: string, value: string]> = [
    ["Active sites", ratioText(dashboard?.activeSites, dashboard?.totalSites)],
    ["Storage locations", ratioText(dashboard?.activeStorageLocations, dashboard?.totalStorageLocations)],
    ["Products", figureText(dashboard?.totalProducts, formatQuantity)],
    ["Suppliers", figureText(dashboard?.totalSuppliers, formatQuantity)],
    ["Quantity on hand", figureText(dashboard?.totalQuantityOnHand, formatQuantity)],
    ["Reserved quantity", figureText(dashboard?.totalQuantityReserved, formatQuantity)],
  ];

  const now = new Date();
  const events = (Array.isArray(dashboard?.recentActivity) ? dashboard.recentActivity : [])
    .filter((item): item is JsonRecord => typeof item === "object" && item !== null)
    .filter((item) => feedShowsAction(persona, text(item.action, "")))
    .map((item, index) => ({
      key: text(item.eventId, String(index)),
      action: auditActionLabel(text(item.action, ""), text(item.entityType, ""), translateText),
      occurredAt: text(item.occurredAt, ""),
    }));
  const feedGroups: ActivityFeedGroup[] = groupByDay(collapseActivity(events).slice(0, FEED_ROWS), now).map(
    (group) => ({
      key: group.key,
      label: dayLabel(group.offset, group.sample),
      items: group.items.map((item) => ({
        key: item.key,
        title: item.action,
        count: item.count,
        time: formatRelative(item.occurredAt),
        timeTitle: formatDateTime(item.occurredAt),
        dateTime: item.occurredAt,
      })),
    }),
  );

  return (
    <div className="grid gap-8">
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}

      {revenueShown ? (
        <section className="grid gap-3">
          <SectionHeading
            title="Revenue and orders"
            note={`${formatDayLabel(range.fromDay, locale)} – ${formatDayLabel(range.toDay, locale)}`}
            action={siteFilterControl}
          />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            {salesQuery.isPending ? (
              <>
                <Skeleton className="h-40 rounded-2xl" />
                <Skeleton className="h-40 rounded-2xl" />
                <Skeleton className="h-40 rounded-2xl" />
              </>
            ) : (
              <>
                <StatTile
                  featured
                  label={translateText("Revenue")}
                  value={figures.money(sales?.kpis.revenue.current)}
                  hint={<Change pair={sales?.kpis.revenue} format={figures.money} locale={locale} />}
                />
                <StatTile
                  featured
                  label={translateText("Orders")}
                  value={figures.count(sales?.kpis.orderCount.current)}
                  hint={<Change pair={sales?.kpis.orderCount} format={figures.count} locale={locale} />}
                />
                <StatTile
                  featured
                  label={translateText("Average order value")}
                  value={figures.money(sales?.kpis.averageOrderValue.current)}
                  hint={<Change pair={sales?.kpis.averageOrderValue} format={figures.money} locale={locale} />}
                />
              </>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        <SectionHeading title="Needs attention" action={revenueShown ? undefined : siteFilterControl} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {pending
            ? tiles.map((tile) => <Skeleton key={tile.field} className="h-28 rounded-2xl" />)
            : tiles.map((tile) => {
                const value = dashboard?.[tile.field];
                const linked = canAccessSection(tile.section, roles);
                const body = (
                  <StatTile
                    interactive={linked}
                    label={translateText(tile.label)}
                    value={figureText(value, formatQuantity)}
                    tone={tileWarns(tile, value) ? "warning" : undefined}
                  />
                );
                return linked ? (
                  <RouterLink
                    key={tile.field}
                    to={pathForSection(tile.section)}
                    className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {body}
                  </RouterLink>
                ) : (
                  <div key={tile.field}>{body}</div>
                );
              })}
        </div>
      </section>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="grid gap-3">
          <SectionHeading title="Recent activity" />
          <Card variant="soft">
            <CardContent className="py-4">
              {pending ? (
                <Skeleton className="h-48" />
              ) : (
                <ActivityFeed
                  groups={feedGroups}
                  empty={translateText("No recent activity")}
                  viewAll={
                    canAccessSection("audit", roles)
                      ? (className) => (
                          <RouterLink to={pathForSection("audit")} className={className}>
                            {translateText("Open audit log")}
                          </RouterLink>
                        )
                      : undefined
                  }
                />
              )}
            </CardContent>
          </Card>
        </section>
        <section className="grid gap-3">
          <SectionHeading title="Catalog and stock" />
          <Card variant="soft">
            <CardHeader className="sr-only">
              <CardTitle>{translateText("Catalog and stock")}</CardTitle>
            </CardHeader>
            <CardContent className="py-2">
              {pending ? (
                <Skeleton className="h-48" />
              ) : (
                <dl className="divide-y divide-line">
                  {facts.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
                      <dt className="text-muted">{translateText(label)}</dt>
                      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
};
