// Health rules for the System page: thresholds, per-service state, and the status banner's overall tone. Pure, so the
// rules can be tested without React. The Services table and the status line read the same thresholds.
import type { SystemLoad, SystemService } from "../../staff-api.ts";

/** Tones that carry a meaning. Neutral is for "no data" and is not produced here. */
export type HealthTone = "ok" | "warning" | "danger";

// Error ratio is 0..1. Strictly above 1% warns, strictly above 5% is danger.
export const ERROR_RATIO_WARNING = 0.01;
export const ERROR_RATIO_DANGER = 0.05;
// p95 latency in seconds. Strictly above 1 s warns, strictly above 2 s is danger.
export const P95_WARNING_SECONDS = 1;
export const P95_DANGER_SECONDS = 2;
// DB pool utilisation is 0..1. At or above 80% warns, at or above 95% is danger.
export const POOL_WARNING = 0.8;
export const POOL_DANGER = 0.95;
// Oldest unpublished outbox row, in seconds (outbox lag). Strictly above 60 s warns, strictly above 300 s is danger.
export const OUTBOX_LAG_WARNING_SECONDS = 60;
export const OUTBOX_LAG_DANGER_SECONDS = 300;

const RANK: Record<HealthTone, number> = { ok: 0, warning: 1, danger: 2 };

/** The more severe of the two tones. Undefined counts as ok. */
export const worstTone = (...tones: ReadonlyArray<HealthTone | undefined>): HealthTone =>
  tones.reduce<HealthTone>((worst, tone) => (tone !== undefined && RANK[tone] > RANK[worst] ? tone : worst), "ok");

export const errorRatioTone = (ratio: number | null | undefined): HealthTone | undefined => {
  if (ratio === null || ratio === undefined) return undefined;
  if (ratio > ERROR_RATIO_DANGER) return "danger";
  if (ratio > ERROR_RATIO_WARNING) return "warning";
  return undefined;
};

export const latencyTone = (seconds: number | null | undefined): HealthTone | undefined => {
  if (seconds === null || seconds === undefined) return undefined;
  if (seconds > P95_DANGER_SECONDS) return "danger";
  if (seconds > P95_WARNING_SECONDS) return "warning";
  return undefined;
};

export const outboxLagTone = (seconds: number | null | undefined): HealthTone | undefined => {
  if (seconds === null || seconds === undefined) return undefined;
  if (seconds > OUTBOX_LAG_DANGER_SECONDS) return "danger";
  if (seconds > OUTBOX_LAG_WARNING_SECONDS) return "warning";
  return undefined;
};

export const poolTone = (utilisation: number | null | undefined): HealthTone | undefined => {
  if (utilisation === null || utilisation === undefined) return undefined;
  if (utilisation >= POOL_DANGER) return "danger";
  if (utilisation >= POOL_WARNING) return "warning";
  return undefined;
};

/** Used over max, 0..1. Null when either side is missing or the max is not positive. */
export const poolUtilisation = (load: Pick<SystemLoad, "dbPoolUsed" | "dbPoolMax">): number | null => {
  if (load.dbPoolUsed === null || load.dbPoolMax === null || load.dbPoolMax <= 0) return null;
  return load.dbPoolUsed / load.dbPoolMax;
};

export type HealthReason = "ready_down" | "live_down" | "error_ratio" | "latency" | "db_pool" | "outbox_lag";

export type ServiceHealth = {
  name: string;
  /** down: the readiness probe fails. degraded: ready, with a warning condition. healthy: neither. */
  state: "healthy" | "degraded" | "down";
  /** The worst tone across the probes and every metric threshold. */
  tone: HealthTone;
  reasons: HealthReason[];
};

// Readiness down is an outage. A failing liveness probe on a ready service, or a metric past its warning threshold,
// is a degradation. Danger-level metrics raise the tone even though the service still answers.
export const evaluateServiceHealth = (
  service: Pick<SystemService, "name" | "status" | "liveStatus">,
  load: SystemLoad | undefined,
): ServiceHealth => {
  if (service.status === "down") {
    return { name: service.name, state: "down", tone: "danger", reasons: ["ready_down"] };
  }

  const reasons: HealthReason[] = [];
  const tones: HealthTone[] = [];
  const add = (reason: HealthReason, tone: HealthTone | undefined): void => {
    if (tone === undefined) return;
    reasons.push(reason);
    tones.push(tone);
  };

  if (service.liveStatus !== "up") add("live_down", "warning");
  if (load) {
    add("error_ratio", errorRatioTone(load.errorRatio));
    add("latency", latencyTone(load.p95Seconds));
    const utilisation = poolUtilisation(load);
    add("db_pool", poolTone(utilisation));
    add("outbox_lag", outboxLagTone(load.outboxOldestSeconds));
  }

  return {
    name: service.name,
    state: reasons.length === 0 ? "healthy" : "degraded",
    tone: worstTone(...tones),
    reasons,
  };
};

export type OverallHealth = {
  /** neutral when the service list itself is unavailable. */
  tone: HealthTone | "neutral";
  /** Services whose readiness probe fails. */
  downNames: string[];
  /** Services with any tone other than ok, down ones included. */
  affectedNames: string[];
};

export const evaluateOverallHealth = (services: ReadonlyArray<ServiceHealth> | null): OverallHealth => {
  if (services === null) return { tone: "neutral", downNames: [], affectedNames: [] };
  const affected = services.filter((service) => service.tone !== "ok");
  const tone = worstTone(...affected.map((service) => service.tone));
  return {
    tone,
    downNames: services.filter((service) => service.state === "down").map((service) => service.name),
    affectedNames: affected.map((service) => service.name),
  };
};

export type OverallStatus =
  | { kind: "unknown" }
  | { kind: "healthy" }
  /** At least one readiness probe fails. `count` is the number of services that are down. */
  | { kind: "down"; count: number }
  /** Everything answers, but some service has a warning or danger condition. `count` is the number affected. */
  | { kind: "degraded"; count: number };

/** The status pill's meaning. Down takes precedence over degraded, since an outage is the more urgent message. */
export const overallStatus = (overall: OverallHealth): OverallStatus => {
  if (overall.tone === "neutral") return { kind: "unknown" };
  if (overall.downNames.length > 0) return { kind: "down", count: overall.downNames.length };
  if (overall.affectedNames.length > 0) return { kind: "degraded", count: overall.affectedNames.length };
  return { kind: "healthy" };
};
