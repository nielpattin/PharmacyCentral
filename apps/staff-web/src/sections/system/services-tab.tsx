import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "../../components/forms.tsx";
import { translateText } from "../../i18n.ts";
import { readSystemMetricsSummary, type SystemMetricsWindowMinutes, type SystemOverview } from "../../staff-api.ts";
import { SYSTEM_REFRESH_INTERVAL_MS } from "./constants.ts";
import { ServiceTableCard } from "./service-table.tsx";
import { UnavailableCard } from "./system-cards.tsx";

export const ServicesTab = ({
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

  if (overview.services.status === "unavailable") {
    return (
      <UnavailableCard
        title="Services"
        description="Readiness, liveness, and uptime per service."
        error={overview.services.error}
      />
    );
  }
  if (overview.services.data.length === 0) return <EmptyState>{translateText("No services reported.")}</EmptyState>;
  return (
    <ServiceTableCard
      services={overview.services.data}
      load={overview.load.status === "ok" ? overview.load.data : undefined}
      summary={summaryQuery.data}
      onOpen={onOpenService}
    />
  );
};
