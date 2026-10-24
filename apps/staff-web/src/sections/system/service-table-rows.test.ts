import { describe, expect, it } from "vitest";

import type { SystemLoad, SystemMetricsSummary, SystemService } from "../../staff-api.ts";
import { buildServiceTableRows } from "./service-table-rows.ts";

const service = (overrides: Partial<SystemService> = {}): SystemService => ({
  name: "sales-service",
  status: "up",
  httpStatus: 200,
  latencyMs: 12,
  liveStatus: "up",
  liveHttpStatus: 200,
  version: "1.4.2",
  instances: 2,
  uptimePercent24h: 99.95,
  ...overrides,
});

const load = (overrides: Partial<SystemLoad> = {}): SystemLoad => ({
  name: "sales-service",
  errorRatio: 0,
  p95Seconds: 0.4,
  outboxOldestSeconds: null,
  cpuCores: 0.5,
  memoryBytes: 512 * 1024 * 1024,
  eventLoopLagSeconds: 0.01,
  dbPoolUsed: null,
  dbPoolMax: null,
  ...overrides,
});

const summary: SystemMetricsSummary = {
  generatedAt: "t",
  from: 0,
  to: 60,
  stepSeconds: 60,
  services: { "sales-service": { availability: [[0, 1]] } },
};

const tooltip = (time: number) => `t${time}`;

describe("buildServiceTableRows", () => {
  it("carries the readiness, liveness, version and instances of each service", () => {
    const [row] = buildServiceTableRows([service()], [load()], summary, tooltip);
    expect(row).toMatchObject({
      name: "sales-service",
      status: "up",
      liveStatus: "up",
      version: "1.4.2",
      instances: 2,
    });
  });

  it("takes the resource numbers from the load and reads the tone from the health rules", () => {
    const [row] = buildServiceTableRows([service()], [load({ errorRatio: 0.2 })], summary, tooltip);
    expect(row).toMatchObject({ cpuCores: 0.5, eventLoopLagSeconds: 0.01, tone: "danger" });
    expect(row?.health.reasons).toEqual(["error_ratio"]);
  });

  it("leaves the numbers null when the load section has no row for the service", () => {
    const [row] = buildServiceTableRows([service()], undefined, undefined, tooltip);
    expect(row).toMatchObject({ cpuCores: null, memoryBytes: null, eventLoopLagSeconds: null, tone: "ok" });
    expect(row?.tracker).toEqual([]);
  });

  it("builds one tracker block per availability step, with the caller's tooltip", () => {
    const [row] = buildServiceTableRows([service()], [load()], summary, tooltip);
    expect(row?.tracker).toEqual([{ key: "0", tone: "ok", tooltip: "t0" }]);
  });
});
