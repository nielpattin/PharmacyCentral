import type { Meter } from "@opentelemetry/api";

import { probeEndpoint, type Probes } from "./probes.ts";

export const PROBE_INTERVAL_MS = 15_000;

export type ProbeLoop = {
  start(): void;
  stop(): void;
  /** One round over every service, recording the result. Exposed so tests can drive a round without the timer. */
  runOnce(): Promise<void>;
};

/**
 * Probes every configured service's /health/ready on a timer and exports the outcome as the observable gauge
 * `pharmacy_ops_probe_up{target_service}` (1 up, 0 down) through the OTel metrics pipeline. Prometheus averages it
 * into the 24 h uptime shown on the health grid.
 */
export const createProbeLoop = (options: { probes: Probes; intervalMs: number; meter: Meter }): ProbeLoop => {
  const { probes } = options;
  const latest = new Map<string, number>();
  const gauge = options.meter.createObservableGauge("pharmacy_ops_probe_up", {
    description: "1 when the target service answered its readiness probe on the last ops-console probe round, else 0.",
  });
  gauge.addCallback((observer) => {
    for (const [target, up] of latest) observer.observe(up, { target_service: target });
  });

  const runOnce = async (): Promise<void> => {
    // probeEndpoint never rejects; a refused or timed-out probe is recorded as down.
    await Promise.all(
      probes.services.map(async (target) => {
        const probe = await probeEndpoint(probes, `${target.url}${target.healthPath}`);
        latest.set(target.name, probe.up ? 1 : 0);
      }),
    );
  };

  let timer: NodeJS.Timeout | undefined;
  return {
    start() {
      if (timer !== undefined) return;
      void runOnce();
      timer = setInterval(() => void runOnce(), options.intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
    runOnce,
  };
};
