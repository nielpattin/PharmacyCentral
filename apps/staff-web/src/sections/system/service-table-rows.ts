// Rows for the Services table: each service's readiness and liveness, its health tone, the current resource numbers
// and its uptime tracker. Pure, so the mapping can be tested without React.
import type { SystemLoad, SystemMetricPoint, SystemMetricsSummary, SystemService } from "../../staff-api.ts";
import { evaluateServiceHealth, type HealthTone, type ServiceHealth } from "./health.ts";
import { availabilityTrackerData, type TrackerDatum } from "./uptime-tracker.ts";

export type ServiceTableRow = {
  name: string;
  health: ServiceHealth;
  version: string | null;
  instances: number | null;
  status: SystemService["status"];
  liveStatus: SystemService["liveStatus"];
  tone: HealthTone;
  cpuCores: number | null;
  memoryBytes: number | null;
  eventLoopLagSeconds: number | null;
  uptimePercent24h: number | null;
  tracker: TrackerDatum[];
};

const NO_POINTS: SystemMetricPoint[] = [];

export const buildServiceTableRows = (
  services: ReadonlyArray<SystemService>,
  load: ReadonlyArray<SystemLoad> | undefined,
  summary: SystemMetricsSummary | undefined,
  formatTooltip: (unixSeconds: number, ratio: number | null) => string,
): ServiceTableRow[] => {
  const loadByName = new Map((load ?? []).map((row) => [row.name, row]));
  return services.map((service) => {
    const row = loadByName.get(service.name);
    const health = evaluateServiceHealth(service, row);
    return {
      name: service.name,
      health,
      version: service.version,
      instances: service.instances,
      status: service.status,
      liveStatus: service.liveStatus,
      tone: health.tone,
      cpuCores: row?.cpuCores ?? null,
      memoryBytes: row?.memoryBytes ?? null,
      eventLoopLagSeconds: row?.eventLoopLagSeconds ?? null,
      uptimePercent24h: service.uptimePercent24h,
      tracker: availabilityTrackerData(summary?.services[service.name]?.availability ?? NO_POINTS, formatTooltip),
    };
  });
};
