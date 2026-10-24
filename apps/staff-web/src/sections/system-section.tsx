import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Alert } from "@pharmacy/ui";

import { RefreshButton } from "../components/forms.tsx";
import { translateText } from "../i18n.ts";
import { ApiProblemError, readSystemOverview, type SystemMetricsWindowMinutes } from "../staff-api.ts";
import { DEFAULT_SYSTEM_WINDOW_MINUTES, SYSTEM_REFRESH_INTERVAL_MS } from "./system/constants.ts";
import { evaluateOverallHealth, evaluateServiceHealth } from "./system/health.ts";
import { OverviewTab } from "./system/overview-tab.tsx";
import { ServiceDetailSheet } from "./system/service-detail-sheet.tsx";
import { StatusPill } from "./system/status-pill.tsx";
import { WindowPicker } from "./system/window-picker.tsx";

const systemQueryKey = ["system-overview"] as const;

const formatClock = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

export const SystemSection = (): React.JSX.Element => {
  // The service whose detail sheet is open. The sheet mounts only while a service is selected.
  const [selectedService, setSelectedService] = useState<string | null>(null);
  // The window the availability strips and the sheet's charts read. The header picker drives it.
  const [windowMinutes, setWindowMinutes] = useState<SystemMetricsWindowMinutes>(DEFAULT_SYSTEM_WINDOW_MINUTES);

  const overviewQuery = useQuery({
    queryKey: systemQueryKey,
    queryFn: readSystemOverview,
    refetchInterval: SYSTEM_REFRESH_INTERVAL_MS,
  });
  const overview = overviewQuery.data;
  const error = overviewQuery.error;
  const errorMessage =
    error instanceof ApiProblemError && error.problem.status === 403
      ? "Platform Admin access required."
      : error instanceof Error
        ? error.message
        : error
          ? "Unable to load the system overview."
          : undefined;

  const overall = overview
    ? evaluateOverallHealth(
        overview.services.status === "ok"
          ? overview.services.data.map((service) =>
              evaluateServiceHealth(
                service,
                overview.load.status === "ok" ? overview.load.data.find((row) => row.name === service.name) : undefined,
              ),
            )
          : null,
      )
    : null;

  const grafanaUrl = overview?.links.find((link) => link.label === "Grafana")?.url;

  return (
    <section className="staff-section">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{translateText("System")}</h1>
          <p className="text-sm text-muted">
            {translateText("Service health, queues and the search index. The overview refreshes every 15 seconds.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {overall ? <StatusPill overall={overall} /> : null}
          <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
          {overview ? (
            <span className="text-sm tabular-nums text-muted">
              {`${translateText("Updated")} ${formatClock(overview.generatedAt)}`}
            </span>
          ) : null}
          <RefreshButton onClick={() => void overviewQuery.refetch()} />
        </div>
      </div>
      {errorMessage ? <Alert variant="danger">{translateText(errorMessage)}</Alert> : null}
      {overview ? (
        <OverviewTab overview={overview} windowMinutes={windowMinutes} onOpenService={setSelectedService} />
      ) : errorMessage ? null : (
        <p className="text-sm text-muted">{translateText("Loading system overview...")}</p>
      )}
      {selectedService !== null && overview ? (
        <ServiceDetailSheet
          key={selectedService}
          serviceName={selectedService}
          overview={overview}
          initialWindow={windowMinutes}
          grafanaUrl={grafanaUrl}
          onClose={() => setSelectedService(null)}
        />
      ) : null}
    </section>
  );
};
