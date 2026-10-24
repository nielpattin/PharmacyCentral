import { describe, expect, it } from "vitest";

import type { SystemLoad, SystemService } from "../../staff-api.ts";
import {
  errorRatioTone,
  evaluateOverallHealth,
  evaluateServiceHealth,
  latencyTone,
  overallStatus,
  poolTone,
  poolUtilisation,
  worstTone,
} from "./health.ts";

const service = (overrides: Partial<SystemService> = {}): SystemService => ({
  name: "sales-service",
  status: "up",
  httpStatus: 200,
  latencyMs: 12,
  liveStatus: "up",
  liveHttpStatus: 200,
  version: "1.4.0",
  instances: 2,
  uptimePercent24h: 99.9,
  ...overrides,
});

const load = (overrides: Partial<SystemLoad> = {}): SystemLoad => ({
  name: "sales-service",
  errorRatio: 0,
  p95Seconds: 0.2,
  outboxOldestSeconds: 0,
  cpuCores: 0.3,
  memoryBytes: 200 * 1024 * 1024,
  eventLoopLagSeconds: 0.01,
  dbPoolUsed: 4,
  dbPoolMax: 20,
  ...overrides,
});

describe("threshold tones", () => {
  it("error ratio warns strictly above 1% and is danger strictly above 5%", () => {
    expect(errorRatioTone(0.01)).toBeUndefined();
    expect(errorRatioTone(0.0101)).toBe("warning");
    expect(errorRatioTone(0.05)).toBe("warning");
    expect(errorRatioTone(0.0501)).toBe("danger");
    expect(errorRatioTone(null)).toBeUndefined();
  });

  it("p95 warns strictly above 1 s and is danger strictly above 2 s", () => {
    expect(latencyTone(1)).toBeUndefined();
    expect(latencyTone(1.5)).toBe("warning");
    expect(latencyTone(2)).toBe("warning");
    expect(latencyTone(2.01)).toBe("danger");
    expect(latencyTone(null)).toBeUndefined();
  });

  it("pool warns at 80% and is danger at 95%, both inclusive", () => {
    expect(poolTone(0.79)).toBeUndefined();
    expect(poolTone(0.8)).toBe("warning");
    expect(poolTone(0.94)).toBe("warning");
    expect(poolTone(0.95)).toBe("danger");
    expect(poolTone(undefined)).toBeUndefined();
  });

  it("pool utilisation needs both sides and a positive max", () => {
    expect(poolUtilisation({ dbPoolUsed: 5, dbPoolMax: 20 })).toBe(0.25);
    expect(poolUtilisation({ dbPoolUsed: 5, dbPoolMax: 0 })).toBeNull();
    expect(poolUtilisation({ dbPoolUsed: null, dbPoolMax: 20 })).toBeNull();
  });

  it("worstTone ranks danger over warning over ok", () => {
    expect(worstTone()).toBe("ok");
    expect(worstTone("warning", undefined, "ok")).toBe("warning");
    expect(worstTone("warning", "danger")).toBe("danger");
  });
});

describe("evaluateServiceHealth", () => {
  it("is down and danger when readiness fails, whatever the metrics say", () => {
    const result = evaluateServiceHealth(service({ status: "down" }), load());
    expect(result).toEqual({ name: "sales-service", state: "down", tone: "danger", reasons: ["ready_down"] });
  });

  it("is healthy when ready, live and every metric is within its band", () => {
    const result = evaluateServiceHealth(service(), load());
    expect(result).toEqual({ name: "sales-service", state: "healthy", tone: "ok", reasons: [] });
  });

  it("degrades when ready but not live, without a load entry", () => {
    const result = evaluateServiceHealth(service({ liveStatus: "down" }), undefined);
    expect(result.state).toBe("degraded");
    expect(result.tone).toBe("warning");
    expect(result.reasons).toEqual(["live_down"]);
  });

  it("degrades on each warning rule and records the reason", () => {
    const result = evaluateServiceHealth(
      service(),
      load({ errorRatio: 0.02, p95Seconds: 1.2, dbPoolUsed: 17, dbPoolMax: 20, outboxOldestSeconds: 90 }),
    );
    expect(result.state).toBe("degraded");
    expect(result.tone).toBe("warning");
    expect(result.reasons).toEqual(["error_ratio", "latency", "db_pool", "outbox_lag"]);
  });

  it("keeps the service degraded but raises the tone to danger for danger-level metrics", () => {
    const result = evaluateServiceHealth(service(), load({ errorRatio: 0.09 }));
    expect(result.state).toBe("degraded");
    expect(result.tone).toBe("danger");
    expect(result.reasons).toEqual(["error_ratio"]);
  });

  it("does not treat an outbox lag of exactly 60 s as a warning", () => {
    expect(evaluateServiceHealth(service(), load({ outboxOldestSeconds: 60 })).state).toBe("healthy");
    expect(evaluateServiceHealth(service(), load({ outboxOldestSeconds: 61 })).reasons).toEqual(["outbox_lag"]);
  });

  it("raises the tone to danger when the outbox lag is above 300 s, and not at exactly 300 s", () => {
    expect(evaluateServiceHealth(service(), load({ outboxOldestSeconds: 300 })).tone).toBe("warning");
    expect(evaluateServiceHealth(service(), load({ outboxOldestSeconds: 301 })).tone).toBe("danger");
  });
});

describe("evaluateOverallHealth", () => {
  it("is neutral when the service list is unavailable", () => {
    expect(evaluateOverallHealth(null)).toEqual({ tone: "neutral", downNames: [], affectedNames: [] });
  });

  it("is ok when no service is affected", () => {
    const healths = [evaluateServiceHealth(service(), load())];
    expect(evaluateOverallHealth(healths)).toEqual({ tone: "ok", downNames: [], affectedNames: [] });
  });

  it("lists affected services and the ones that are down", () => {
    const healths = [
      evaluateServiceHealth(service({ name: "a", status: "down" }), undefined),
      evaluateServiceHealth(service({ name: "b", liveStatus: "down" }), undefined),
      evaluateServiceHealth(service({ name: "c" }), load({ name: "c" })),
    ];
    const result = evaluateOverallHealth(healths);
    expect(result.tone).toBe("danger");
    expect(result.downNames).toEqual(["a"]);
    expect(result.affectedNames).toEqual(["a", "b"]);
  });

  it("is warning when services are degraded but none is down or in danger", () => {
    const healths = [evaluateServiceHealth(service({ name: "b", liveStatus: "down" }), undefined)];
    expect(evaluateOverallHealth(healths).tone).toBe("warning");
  });
});

describe("overallStatus", () => {
  const overall = (tone: "ok" | "warning" | "danger" | "neutral", downNames: string[], affectedNames: string[]) => ({
    tone,
    downNames,
    affectedNames,
  });

  it("is unknown without a service list, healthy when nothing is affected", () => {
    expect(overallStatus(overall("neutral", [], []))).toEqual({ kind: "unknown" });
    expect(overallStatus(overall("ok", [], []))).toEqual({ kind: "healthy" });
  });

  it("reports an outage ahead of degradation", () => {
    expect(overallStatus(overall("danger", ["sales"], ["sales", "catalog"]))).toEqual({ kind: "down", count: 1 });
    expect(overallStatus(overall("warning", [], ["catalog", "search"]))).toEqual({ kind: "degraded", count: 2 });
  });
});
