import { useQuery } from "@tanstack/react-query";

import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton, StatTile, type StatTileProps } from "@pharmacy/ui";

import { translateText } from "../i18n.ts";
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
  const kpis: Kpi[] = [
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
    { label: "Low stock batches", value: formatQuantity(dashboard?.lowStockBatchCount), tone: "warning" },
    { label: "Expiring batches", value: formatQuantity(dashboard?.expiringBatchCount), tone: "warning" },
    { label: "Pending transfers", value: formatQuantity(dashboard?.pendingTransferCount) },
    { label: "Open prescriptions", value: formatQuantity(dashboard?.openPrescriptionCount) },
    { label: "Open stocktakes", value: formatQuantity(dashboard?.openStocktakeCount) },
    { label: "Pending adjustments", value: formatQuantity(dashboard?.pendingAdjustmentCount) },
  ];

  return (
    <div className="grid gap-6">
      {error ? <Alert variant="danger">{translateText(error)}</Alert> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
        {dashboardQuery.isPending
          ? Array.from({ length: 12 }, (_, index) => <Skeleton key={index} className="h-[88px]" />)
          : kpis.map((kpi) => (
              <StatTile key={kpi.label} label={translateText(kpi.label)} value={kpi.value} tone={kpi.tone} />
            ))}
      </div>
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
                  <span className="font-medium text-ink">{translateText(text(item.eventType))}</span>
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
