import type { Probes } from "./probes.ts";
import { frameAt, pointStepSeconds, queryRangeByLabel, toGrid, type Point } from "./prometheus.ts";

export type ServiceSummary = {
  /** 0..1 per step: the average of the probe gauge over the step. */
  availability: Point[];
};

export type MetricsSummary = {
  generatedAt: string;
  from: number;
  to: number;
  stepSeconds: number;
  services: Record<string, ServiceSummary>;
};

/**
 * Availability per configured service over the window, for the uptime strip. One range query grouped by the probed
 * target, never one query per service.
 */
export const probeMetricsSummary = async (
  probes: Probes,
  windowMinutes: number,
  now: Date,
): Promise<MetricsSummary> => {
  const names = probes.services.map((target) => target.name);
  const stepSeconds = pointStepSeconds(windowMinutes);
  const { from, to } = frameAt(now, windowMinutes, stepSeconds);
  const up = await queryRangeByLabel(
    probes,
    `avg by (target_service)(avg_over_time(pharmacy_ops_probe_up[${Math.max(stepSeconds, 60)}s]))`,
    "target_service",
    from,
    to,
    stepSeconds,
  );
  return {
    generatedAt: now.toISOString(),
    from,
    to,
    stepSeconds,
    services: Object.fromEntries(
      names.map((name): [string, ServiceSummary] => [
        name,
        { availability: toGrid(up.get(name), from, to, stepSeconds) },
      ]),
    ),
  };
};
