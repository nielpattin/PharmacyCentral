import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Alert } from "@pharmacy/ui";

import { SubTabs } from "../components/forms.tsx";
import { useListUrlState } from "../hooks/useListUrlState.ts";
import { translateText } from "../i18n.ts";
import { ApiProblemError, readSystemOverview, type SystemMetricsWindowMinutes } from "../staff-api.ts";
import { DEFAULT_SYSTEM_WINDOW_MINUTES, SYSTEM_REFRESH_INTERVAL_MS } from "./system/constants.ts";
import { evaluateOverallHealth, evaluateServiceHealth } from "./system/health.ts";
import { GrafanaCard } from "./system/grafana-card.tsx";
import { MessagingTab } from "./system/messaging-tab.tsx";
import { RoutesCard } from "./system/routes-card.tsx";
import { ServiceDetailSheet } from "./system/service-detail-sheet.tsx";
import { ServicesTab } from "./system/services-tab.tsx";
import { StatusPill } from "./system/status-pill.tsx";
import { isSystemTab, SYSTEM_TABS } from "./system/tabs.ts";
import { WindowPicker } from "./system/window-picker.tsx";

const systemQueryKey = ["system-overview"] as const;

const formatClock = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

const LIST_DEFAULTS = { tab: "Services" } as const;

export const SystemSection = (): React.JSX.Element => {
  const list = useListUrlState(LIST_DEFAULTS);
  const tab = isSystemTab(list.values.tab) ? list.values.tab : LIST_DEFAULTS.tab;
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
        <p className="text-sm text-muted">
          {translateText("Service health, queues and the search index. The overview refreshes every 15 seconds.")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {overall ? <StatusPill overall={overall} /> : null}
          {tab === "Services" ? <WindowPicker value={windowMinutes} onChange={setWindowMinutes} /> : null}
          {overview ? (
            <span className="text-sm tabular-nums text-muted">
              {`${translateText("Updated")} ${formatClock(overview.generatedAt)}`}
            </span>
          ) : null}
        </div>
      </div>
      {errorMessage ? <Alert variant="danger">{translateText(errorMessage)}</Alert> : null}
      <SubTabs
        className="mt-4"
        tabs={[...SYSTEM_TABS]}
        active={tab}
        onChange={(next) => {
          setSelectedService(null);
          list.setValues({ tab: next }, { history: "push" });
        }}
      />
      {tab === "API routes" ? <RoutesCard /> : null}
      {overview ? (
        <>
          {tab === "Services" ? (
            <ServicesTab overview={overview} windowMinutes={windowMinutes} onOpenService={setSelectedService} />
          ) : null}
          {tab === "Messaging" ? <MessagingTab overview={overview} /> : null}
          {tab === "Dashboards" ? <GrafanaCard baseUrl={grafanaUrl} /> : null}
        </>
      ) : tab === "API routes" || errorMessage ? null : (
        <p className="text-sm text-muted">{translateText("Loading system overview...")}</p>
      )}
      {tab === "Services" && selectedService !== null && overview ? (
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
