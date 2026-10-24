import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "../../components/forms.tsx";
import { translateText } from "../../i18n.ts";
import { readSystemMetricsSummary, type SystemMetricsWindowMinutes, type SystemOverview } from "../../staff-api.ts";
import { SYSTEM_REFRESH_INTERVAL_MS } from "./constants.ts";
import { GrafanaCard } from "./grafana-card.tsx";
import { QueuesCard } from "./queues-card.tsx";
import { SearchIndexCard } from "./search-index-card.tsx";
import { ServiceTableCard } from "./service-table.tsx";
import { UnavailableCard } from "./system-cards.tsx";

// The Grafana link the overview lists under its dashboards. Its base URL builds the bookmarks on the Grafana card.
const GRAFANA_LABEL = "Grafana";

export const OverviewTab = ({
  overview,
  windowMinutes,
  onOpenService,
}: {
  overview: SystemOverview;
  windowMinutes: SystemMetricsWindowMinutes;
  onOpenService: (name: string) => void;
}): React.JSX.Element => {
  // The availability strips read the window; a failed summary only blanks the strips, not the services.
  const summaryQuery = useQuery({
    queryKey: ["system-metrics-summary", windowMinutes],
    queryFn: () => readSystemMetricsSummary(windowMinutes),
    refetchInterval: SYSTEM_REFRESH_INTERVAL_MS,
    retry: false,
  });

  const grafanaUrl = overview.links.find((link) => link.label === GRAFANA_LABEL)?.url;

  return (
    <div className="grid gap-4">
      {overview.services.status === "unavailable" ? (
        <UnavailableCard
          title="Services"
          description="Readiness, liveness, and uptime per service."
          error={overview.services.error}
        />
      ) : overview.services.data.length === 0 ? (
        <EmptyState>{translateText("No services reported.")}</EmptyState>
      ) : (
        <ServiceTableCard
          services={overview.services.data}
          load={overview.load.status === "ok" ? overview.load.data : undefined}
          summary={summaryQuery.data}
          onOpen={onOpenService}
        />
      )}

      <QueuesCard queues={overview.queues} />
      <SearchIndexCard searchIndex={overview.searchIndex} />
      <GrafanaCard baseUrl={grafanaUrl} />
    </div>
  );
};
