import type { Probes } from "./probes.ts";
import { rateSpan, HTTP_DURATION, selectorFor, spanClause } from "./promql.ts";

export type Point = [unixSeconds: number, value: number | null];

export type Vector = { metric: Record<string, string>; value: number };

type PrometheusResponse = {
  status?: string;
  error?: string;
  data?: {
    result?: (
      | { metric: Record<string, string>; value: [number, string] }
      | { metric: Record<string, string>; values: [number, string][] }
    )[];
  };
};

const prometheusGet = async (
  probes: Probes,
  path: string,
  params: Record<string, string>,
): Promise<PrometheusResponse> => {
  const response = await probes.fetch(`${probes.prometheusUrl}${path}?${new URLSearchParams(params).toString()}`, {
    signal: AbortSignal.timeout(probes.queryTimeoutMs),
  });
  const body = (await response.json()) as PrometheusResponse;
  if (!response.ok || body.status !== "success") {
    throw new Error(`prometheus answered ${response.status}${body.error ? `: ${body.error}` : ""}`);
  }
  return body;
};

const finite = (raw: string | number): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Instant query. Series without a finite value are left out. */
export const queryVector = async (probes: Probes, query: string): Promise<Vector[]> => {
  const body = await prometheusGet(probes, "/api/v1/query", { query });
  const vectors: Vector[] = [];
  for (const series of body.data?.result ?? []) {
    if (!("value" in series)) continue;
    const value = finite(series.value[1]);
    if (value !== null) vectors.push({ metric: series.metric, value });
  }
  return vectors;
};

/** Instant query keyed by one label. A series without that label is left out. */
export const queryByLabel = async (probes: Probes, query: string, label: string): Promise<Map<string, number>> => {
  const byLabel = new Map<string, number>();
  for (const vector of await queryVector(probes, query)) {
    const key = vector.metric[label];
    if (key) byLabel.set(key, vector.value);
  }
  return byLabel;
};

/** Range query, as timestamp (seconds) -> value. Timestamps with no sample are absent. */
export const queryRange = async (
  probes: Probes,
  query: string,
  start: number,
  end: number,
  step: number,
): Promise<Map<number, number>> => {
  const body = await prometheusGet(probes, "/api/v1/query_range", {
    query,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const points = new Map<number, number>();
  for (const series of body.data?.result ?? []) {
    if (!("values" in series)) continue;
    for (const [timestamp, raw] of series.values) {
      const value = finite(raw);
      if (value !== null) points.set(timestamp, value);
    }
  }
  return points;
};

/** Range query keyed by one label: label value -> (timestamp -> value). Series without that label are left out. */
export const queryRangeByLabel = async (
  probes: Probes,
  query: string,
  label: string,
  start: number,
  end: number,
  step: number,
): Promise<Map<string, Map<number, number>>> => {
  const body = await prometheusGet(probes, "/api/v1/query_range", {
    query,
    start: String(start),
    end: String(end),
    step: String(step),
  });
  const byLabel = new Map<string, Map<number, number>>();
  for (const series of body.data?.result ?? []) {
    if (!("values" in series)) continue;
    const key = series.metric[label];
    if (!key) continue;
    const points = byLabel.get(key) ?? new Map<number, number>();
    for (const [timestamp, raw] of series.values) {
      const value = finite(raw);
      if (value !== null) points.set(timestamp, value);
    }
    byLabel.set(key, points);
  }
  return byLabel;
};

export type Frame = { from: number; to: number; stepSeconds: number };

/**
 * The window ending now, with its end aligned to the step, so every series of one response shares its timestamps.
 * `from` is the window start; the grid returned by `gridTimes` runs from `from` to `to` inclusive.
 */
export const frameAt = (now: Date, windowMinutes: number, stepSeconds: number): Frame => {
  const to = Math.floor(now.getTime() / 1000 / stepSeconds) * stepSeconds;
  return { from: to - windowMinutes * 60, to, stepSeconds };
};

/** Step for the window views (summary): at most 60 steps, never finer than 15 s. */
export const pointStepSeconds = (windowMinutes: number): number => Math.max(15, Math.ceil((windowMinutes * 60) / 60));

/** Timestamps of the grid, inclusive of both ends. */
export const gridTimes = (from: number, to: number, step: number): number[] => {
  const times: number[] = [];
  for (let timestamp = from; timestamp <= to; timestamp += step) times.push(timestamp);
  return times;
};

/** One series on the grid: the value at each timestamp, null where Prometheus has no sample. */
export const toGrid = (points: Map<number, number> | undefined, from: number, to: number, step: number): Point[] =>
  gridTimes(from, to, step).map((timestamp) => [timestamp, points?.get(timestamp) ?? null]);

export type ServiceFacts = {
  version: string | null;
  instances: number | null;
  uptimePercent24h: number | null;
};

/**
 * Per-service facts the health grid needs from Prometheus, keyed by service name.
 *
 * Node services export through OTLP with `job` set to the service name, and their resource attributes land on
 * target_info rather than on each metric. target_info outlives the process that wrote it, so it cannot count live
 * instances. The process gauge every service pushes can: it carries host_name (promoted in prometheus.yml locally,
 * a resource-to-label conversion on AWS), so one series is one running instance and a dead one goes stale after the
 * 5 minute lookback. The version is the newest target_info row.
 */
export const probeServiceFacts = async (probes: Probes): Promise<Map<string, ServiceFacts>> => {
  const [instances, versions, uptime] = await Promise.all([
    queryByLabel(probes, "count by (service_name)(pharmacy_process_resident_memory_bytes)", "service_name"),
    queryVector(probes, "topk by (job)(1, timestamp(target_info))"),
    queryByLabel(probes, "100 * avg by (target_service)(avg_over_time(pharmacy_ops_probe_up[24h]))", "target_service"),
  ]);
  const versionByJob = new Map<string, string>();
  for (const vector of versions) {
    const job = vector.metric.job;
    const version = vector.metric.service_version;
    if (job && version) versionByJob.set(job, version);
  }
  const names = new Set([...instances.keys(), ...versionByJob.keys(), ...uptime.keys()]);
  return new Map(
    [...names].map((name) => [
      name,
      {
        version: versionByJob.get(name) ?? null,
        instances: instances.get(name) ?? null,
        uptimePercent24h: uptime.get(name) ?? null,
      },
    ]),
  );
};

export type ServiceLoad = {
  name: string;
  /** 0..1, 5xx over all requests in the last 5 minutes. Null when the service took no requests. */
  errorRatio: number | null;
  p95Seconds: number | null;
  outboxOldestSeconds: number | null;
  cpuCores: number | null;
  memoryBytes: number | null;
  eventLoopLagSeconds: number | null;
  dbPoolUsed: number | null;
  dbPoolMax: number | null;
};

export const probeLoad = async (probes: Probes): Promise<ServiceLoad[]> => {
  const byService = (query: string) => queryByLabel(probes, query, "service_name");
  const [requests, errors, p95, oldest, cpu, memory, lag, dbUsed, dbMax] = await Promise.all([
    byService(`sum by (service_name)(rate(${HTTP_DURATION}_count[5m]))`),
    byService(`sum by (service_name)(rate(${HTTP_DURATION}_count{http_response_status_code=~"5.."}[5m]))`),
    byService(`histogram_quantile(0.95, sum by (le, service_name)(rate(${HTTP_DURATION}_bucket[5m])))`),
    byService("max by (service_name)(pharmacy_outbox_oldest_age_seconds)"),
    byService("sum by (service_name)(rate(pharmacy_process_cpu_seconds_total[5m]))"),
    byService("sum by (service_name)(pharmacy_process_resident_memory_bytes)"),
    byService("max by (service_name)(pharmacy_process_event_loop_lag_seconds)"),
    byService('sum by (service_name)(db_client_connection_count{db_client_connection_state="used"})'),
    byService("sum by (service_name)(db_client_connection_max)"),
  ]);
  const names = new Set(
    [requests, errors, p95, oldest, cpu, memory, lag, dbUsed, dbMax].flatMap((series) => [...series.keys()]),
  );
  return [...names].sort().map((name) => {
    const requestsPerSecond = requests.get(name) ?? 0;
    const errorsPerSecond = errors.get(name) ?? 0;
    return {
      name,
      errorRatio: requestsPerSecond > 0 ? Math.min(1, errorsPerSecond / requestsPerSecond) : null,
      p95Seconds: p95.get(name) ?? null,
      outboxOldestSeconds: oldest.get(name) ?? null,
      cpuCores: cpu.get(name) ?? null,
      memoryBytes: memory.get(name) ?? null,
      eventLoopLagSeconds: lag.get(name) ?? null,
      dbPoolUsed: dbUsed.get(name) ?? null,
      dbPoolMax: dbMax.get(name) ?? null,
    };
  });
};

export type MetricsRange = {
  generatedAt: string;
  service: string;
  from: number;
  to: number;
  stepSeconds: number;
  series: {
    cpuCores: Point[];
    memoryBytes: Point[];
    eventLoopLagSeconds: Point[];
  };
};

/**
 * Step keeps each series at about 120 points or fewer, and never below 60 s: the OTLP metric export interval is 60 s,
 * so a finer step only adds empty points.
 */
export const rangeStepSeconds = (windowMinutes: number): number => Math.max(60, Math.ceil((windowMinutes * 60) / 120));

/**
 * One range of the service detail view. `service` is a configured service name or ALL_SERVICES, which sums the
 * configured services into one aggregate series per metric.
 */
export const probeMetricsRange = async (
  probes: Probes,
  service: string,
  windowMinutes: number,
  now: Date,
): Promise<MetricsRange> => {
  const step = rangeStepSeconds(windowMinutes);
  const { from, to } = frameAt(now, windowMinutes, step);
  const span = rateSpan(step);
  const names = probes.services.map((target) => target.name);
  const selector = selectorFor(service, names);
  const selected = (metric: string) => `${metric}{${selector}}`;
  const queries = {
    cpuCores: `sum(rate(${selected("pharmacy_process_cpu_seconds_total")}${spanClause(span)}))`,
    memoryBytes: `sum(${selected("pharmacy_process_resident_memory_bytes")})`,
    eventLoopLagSeconds: `max(${selected("pharmacy_process_event_loop_lag_seconds")})`,
  } as const;
  const entries = await Promise.all(
    (Object.keys(queries) as (keyof typeof queries)[]).map(async (key) => {
      const points = await queryRange(probes, queries[key], from, to, step);
      return [key, toGrid(points, from, to, step)] as const;
    }),
  );
  return {
    generatedAt: now.toISOString(),
    service,
    from,
    to,
    stepSeconds: step,
    series: Object.fromEntries(entries) as MetricsRange["series"],
  };
};
