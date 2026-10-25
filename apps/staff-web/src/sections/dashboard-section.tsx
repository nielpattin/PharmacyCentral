import { useQuery } from "@tanstack/react-query";

import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton, StatTile, type StatTileProps } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
import { auditActionLabel } from "./governance/audit-query.ts";
import { formatDateTime, formatQuantity, readOne, text, type JsonRecord } from "../staff-api.ts";

type Kpi = { label: string; value: string; tone?: StatTileProps["tone"] };

export const DashboardSection = (): React.JSX.Element => {
  const dashboardQuery = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => readOne<JsonRecord>("/api/dashboard/summary"),
  });
  const dashboard = dashboardQuery.data;
  const error = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : undefined;
  const recent = Array.isArray(dashboard?.recentActivity)
    ? dashboard.recentActivity.filter((item): item is JsonRecord => typeof item === "object" && item !== null)
    : [];
  // A warning edge only while the count is above zero; on a zero it would be a false alarm.
  const warnWhenPositive = (value: unknown): Kpi["tone"] => (Number(value) > 0 ? "warning" : undefined);
  const attention: Kpi[] = [
    {
      label: "Low stock batches",
      value: formatQuantity(dashboard?.lowStockBatchCount),
      tone: warnWhenPositive(dashboard?.lowStockBatchCount),
    },
    {
      label: "Expiring batches",
      value: formatQuantity(dashboard?.expiringBatchCount),
      tone: warnWhenPositive(dashboard?.expiringBatchCount),
    },
    { label: "Pending transfers", value: formatQuantity(dashboard?.pendingTransferCount) },
    { label: "Open prescriptions", value: formatQuantity(dashboard?.openPrescriptionCount) },
    { label: "Open stocktakes", value: formatQuantity(dashboard?.openStocktakeCount) },
    { label: "Pending adjustments", value: formatQuantity(dashboard?.pendingAdjustmentCount) },
  ];
  const overview: Kpi[] = [
    {
      label: "Active sites",
      value: `${formatQuantity(dashboard?.activeSites)} / ${formatQuantity(dashboard?.totalSites)}`,
    },
    {
      label: "Storage locations",
      value: `${formatQuantity(dashboard?.activeStorageLocations)} / ${formatQuantity(dashboard?.totalStorageLocations)}`,
    },
    { label: "Products", value: formatQuantity(dashboard?.totalProducts) },
    { label: "Suppliers", value: formatQuantity(dashboard?.totalSuppliers) },
    { label: "Quantity on hand", value: formatQuantity(dashboard?.totalQuantityOnHand) },
    { label: "Reserved quantity", value: formatQuantity(dashboard?.totalQuantityReserved) },
  ];
  const groups: { title: string; kpis: Kpi[] }[] = [
    { title: "Needs attention", kpis: attention },
    { title: "Catalog and stock", kpis: overview },
  ];

  return (
    <div className="grid gap-6">
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
      {groups.map((group) => (
        <section key={group.title} className="grid gap-2">
          <h2 className="text-sm font-semibold text-ink">{translateText(group.title)}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
            {dashboardQuery.isPending
              ? group.kpis.map((kpi) => <Skeleton key={kpi.label} className="h-[78px]" />)
              : group.kpis.map((kpi) => (
                  <StatTile key={kpi.label} label={translateText(kpi.label)} value={kpi.value} tone={kpi.tone} />
                ))}
          </div>
        </section>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>{translateText("Recent activity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {dashboardQuery.isPending ? (
            <Skeleton className="h-24" />
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted">{translateText("No recent activity")}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {recent.map((item, index) => (
                <li
                  key={text(item.eventId, String(index))}
                  className="flex flex-wrap gap-x-2 border-b border-line pb-2 last:border-0"
                >
                  <span className="font-medium text-ink">
                    {auditActionLabel(text(item.action, ""), text(item.entityType, ""), translateText)}
                  </span>
                  <span className="text-muted">
                    {translateText("at")} {formatDateTime(item.occurredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
