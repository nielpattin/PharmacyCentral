import { useState } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  Alert,
  AreaTrend,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sheet,
  Skeleton,
  StatusDot,
  type DataTone,
} from "@pharmacy/ui";

import { translateText } from "../../i18n.ts";
import {
  formatQuantity,
  readSystemMetricsRange,
  type SystemMetricPoint,
  type SystemMetricsRange,
  type SystemMetricsWindowMinutes,
  type SystemOverview,
} from "../../staff-api.ts";
import { SYSTEM_HEAVY_REFRESH_INTERVAL_MS } from "./constants.ts";
import { DASH, formatChartTime, formatMilliseconds } from "./format.ts";
import { evaluateServiceHealth, type HealthReason, type HealthTone } from "./health.ts";
import { serviceDashboardUrl, serviceLogsUrl, serviceTracesUrl } from "./grafana-links.ts";
import { WindowPicker } from "./window-picker.tsx";
import { metricsErrorMessage } from "./system-errors.ts";

// Windows longer than six hours include the date on the time axis.
const LONG_WINDOW_MINUTES = 360;

const REASON_LABEL: Record<HealthReason, string> = {
  ready_down: "Readiness probe failing",
  live_down: "Liveness probe failing",
  error_ratio: "5xx share above the threshold",
  latency: "p95 latency above the threshold",
  db_pool: "DB pool close to its maximum",
  outbox_lag: "Outbox lag above the threshold",
};

const DOT_TONE: Record<HealthTone, "ok" | "warning" | "danger"> = { ok: "ok", warning: "warning", danger: "danger" };

type ChartMeta = {
  title: string;
  description: string;
  label: string;
  tone: DataTone;
  /** Converts the stored unit into the one the chart shows. */
  scale: number;
  formatValue: (value: number) => string;
  pick: (range: SystemMetricsRange) => SystemMetricPoint[];
};

// One chart per resource, all from the service's range. Event loop lag is the saturation signal Grafana does not chart
// next to the table.
const CHARTS: ChartMeta[] = [
  {
    title: "CPU",
    description: "Process CPU in millicores (1000 m is one core), summed over instances.",
    label: "CPU (m)",
    tone: "chart-3",
    scale: 1000,
    formatValue: (value) => `${formatQuantity(Math.round(value))} m`,
    pick: (range) => range.series.cpuCores,
  },
  {
    title: "Memory",
    description: "Resident memory in MiB, summed over instances.",
    label: "Memory (MiB)",
    tone: "chart-4",
    scale: 1 / (1024 * 1024),
    formatValue: (value) => `${formatQuantity(value)} MiB`,
    pick: (range) => range.series.memoryBytes,
  },
  {
    title: "Event loop lag",
    description: "Delay of the Node.js event loop in milliseconds, the largest value over instances.",
    label: "Lag (ms)",
    tone: "chart-1",
    scale: 1000,
    formatValue: (value) => formatMilliseconds(value),
    pick: (range) => range.series.eventLoopLagSeconds,
  },
];

const ChartCard = ({
  meta,
  range,
  includeDate,
}: {
  meta: ChartMeta;
  range: SystemMetricsRange;
  includeDate: boolean;
}): React.JSX.Element => (
  <Card>
    <CardHeader className="grid gap-1 border-b-0 pb-0">
      <CardTitle className="text-sm font-medium">{translateText(meta.title)}</CardTitle>
      <p className="text-sm text-muted">{translateText(meta.description)}</p>
    </CardHeader>
    <CardContent>
      <AreaTrend
        series={[
          {
            key: meta.title,
            label: translateText(meta.label),
            tone: meta.tone,
            points: meta
              .pick(range)
              .map(([time, value]): SystemMetricPoint => [time, value === null ? null : value * meta.scale]),
          },
        ]}
        height={180}
        formatValue={meta.formatValue}
        formatTime={(unixSeconds) => formatChartTime(unixSeconds, includeDate)}
      />
    </CardContent>
  </Card>
);

export const ServiceDetailSheet = ({
  serviceName,
  overview,
  initialWindow,
  grafanaUrl,
  onClose,
}: {
  serviceName: string;
  overview: SystemOverview;
  initialWindow: SystemMetricsWindowMinutes;
  /** The Grafana base URL from the overview's links. Undefined hides the Grafana links. */
  grafanaUrl: string | undefined;
  onClose: () => void;
}): React.JSX.Element => {
  const [windowMinutes, setWindowMinutes] = useState<SystemMetricsWindowMinutes>(initialWindow);
  const service =
    overview.services.status === "ok" ? overview.services.data.find((row) => row.name === serviceName) : undefined;
  const load = overview.load.status === "ok" ? overview.load.data.find((row) => row.name === serviceName) : undefined;

  const rangeQuery = useQuery({
    queryKey: ["system-metrics-range", serviceName, windowMinutes],
    queryFn: () => readSystemMetricsRange(serviceName, windowMinutes),
    refetchInterval: SYSTEM_HEAVY_REFRESH_INTERVAL_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const includeDate = windowMinutes > LONG_WINDOW_MINUTES;
  const health = service ? evaluateServiceHealth(service, load) : undefined;

  let charts: React.JSX.Element;
  if (rangeQuery.data) {
    const range = rangeQuery.data;
    charts = (
      <div className="grid gap-4 md:grid-cols-2">
        {CHARTS.map((meta) => (
          <ChartCard key={meta.title} meta={meta} range={range} includeDate={includeDate} />
        ))}
      </div>
    );
  } else if (rangeQuery.isError) {
    charts = <Alert variant="danger">{translateText(metricsErrorMessage(rangeQuery.error))}</Alert>;
  } else {
    charts = <Skeleton className="h-96" />;
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={serviceName}
      description={translateText("Service detail")}
      width="xl"
      closeLabel={translateText("Close")}
    >
      <div className="grid gap-6">
        <header className="grid gap-3">
          {service ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-2">
                <StatusDot tone={health ? DOT_TONE[health.tone] : "ok"} />
                <span>{translateText(service.status === "up" ? "Ready" : "Down")}</span>
              </span>
              <Badge variant={service.liveStatus === "up" ? "success" : "danger"}>
                {translateText(service.liveStatus === "up" ? "Live" : "Live down")}
              </Badge>
              {service.version ? <Badge variant="outline">{service.version}</Badge> : null}
              <span className="text-muted">
                {service.instances === null
                  ? DASH
                  : `${formatQuantity(service.instances)} ${translateText("instances")}`}
              </span>
              <span className="text-muted tabular-nums">
                {`${translateText("Uptime 24h")}: ${
                  service.uptimePercent24h === null ? DASH : `${formatQuantity(service.uptimePercent24h)}%`
                }`}
              </span>
            </div>
          ) : (
            <Alert variant="danger">{translateText("This service is not in the current health list.")}</Alert>
          )}
          {health && health.reasons.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {health.reasons.map((reason) => (
                <li key={reason}>
                  <Badge variant={health.tone === "danger" ? "danger" : "warning"}>
                    {translateText(REASON_LABEL[reason])}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <WindowPicker value={windowMinutes} onChange={setWindowMinutes} />
            {grafanaUrl === undefined ? null : (
              <nav aria-label={translateText("Grafana")} className="flex flex-wrap gap-4 text-sm">
                <a
                  href={serviceDashboardUrl(grafanaUrl, serviceName)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  {translateText("Service Overview")}
                </a>
                <a
                  href={serviceTracesUrl(grafanaUrl, serviceName)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  {translateText("Traces")}
                </a>
                <a
                  href={serviceLogsUrl(grafanaUrl, serviceName)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  {translateText("Logs")}
                </a>
              </nav>
            )}
          </div>
        </header>

        {charts}
      </div>
    </Sheet>
  );
};
