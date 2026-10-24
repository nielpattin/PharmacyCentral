import { describe, expect, it } from "vitest";

import type { Probes } from "./probes.ts";
import { probeLoad, probeMetricsRange, probeServiceFacts, rangeStepSeconds } from "./prometheus.ts";

type Recorded = { path: string; params: URLSearchParams };

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

/** Answers instant queries by substring of the PromQL and range queries with one matrix (or none). */
const prometheusProbes = (
  instant: (query: string) => unknown[],
  range: (query: string) => { metric: Record<string, string>; values: [number, string][] }[] = () => [],
): { probes: Probes; recorded: Recorded[] } => {
  const recorded: Recorded[] = [];
  const probes = {
    services: [],
    prometheusUrl: "http://prometheus.test",
    rabbitmq: { url: "", user: "", password: "" },
    typesense: { url: "", apiKey: "" },
    timeoutMs: 500,
    queryTimeoutMs: 500,
    fetch: ((input: string | URL) => {
      const url = new URL(input.toString());
      recorded.push({ path: url.pathname, params: url.searchParams });
      const query = url.searchParams.get("query") ?? "";
      if (url.pathname === "/api/v1/query_range")
        return Promise.resolve(json({ status: "success", data: { resultType: "matrix", result: range(query) } }));
      return Promise.resolve(json({ status: "success", data: { resultType: "vector", result: instant(query) } }));
    }) as typeof fetch,
  } as Probes;
  return { probes, recorded };
};

const vector = (metric: Record<string, string>, value: string) => ({ metric, value: [0, value] });

describe("rangeStepSeconds", () => {
  it("keeps each window to about 120 points and never below one minute", () => {
    expect(rangeStepSeconds(15)).toBe(60);
    expect(rangeStepSeconds(60)).toBe(60);
    expect(rangeStepSeconds(360)).toBe(180);
    expect(rangeStepSeconds(1440)).toBe(720);
    for (const minutes of [15, 60, 360, 1440]) {
      const points = (minutes * 60) / rangeStepSeconds(minutes) + 1;
      expect(points).toBeLessThanOrEqual(121);
    }
  });
});

describe("probeMetricsRange", () => {
  it("builds one aligned grid per series, with null where Prometheus has no sample", async () => {
    const now = new Date("2026-10-24T03:00:37.000Z");
    const to = Math.floor(now.getTime() / 1000 / 60) * 60;
    const { probes, recorded } = prometheusProbes(
      () => [],
      (query) =>
        query.startsWith("sum(pharmacy_process_resident_memory_bytes")
          ? [
              {
                metric: {},
                values: [
                  [to - 60, "2.5"],
                  [to, "4"],
                ],
              },
            ]
          : [],
    );

    const range = await probeMetricsRange(probes, "sales-service", 15, now);

    expect(range).toMatchObject({ service: "sales-service", from: to - 900, to, stepSeconds: 60 });
    expect(Object.keys(range.series).sort()).toEqual(["cpuCores", "eventLoopLagSeconds", "memoryBytes"]);
    expect(range.series.memoryBytes).toHaveLength(16);
    expect(range.series.memoryBytes[0]).toEqual([to - 900, null]);
    expect(range.series.memoryBytes[14]).toEqual([to - 60, 2.5]);
    expect(range.series.memoryBytes[15]).toEqual([to, 4]);
    expect(range.series.cpuCores.every(([, value]) => value === null)).toBe(true);

    const queries = recorded.filter((entry) => entry.path === "/api/v1/query_range");
    expect(queries).toHaveLength(3);
    expect(queries.every((entry) => entry.params.get("step") === "60")).toBe(true);
    expect(queries.every((entry) => entry.params.get("query")?.includes('service_name="sales-service"'))).toBe(true);
  });
});

describe("probeLoad", () => {
  it("maps instant results per service, with the error ratio and nulls where a series is missing", async () => {
    const { probes } = prometheusProbes((query) => {
      if (query.includes('http_response_status_code=~"5.."')) return [vector({ service_name: "sales-service" }, "0.5")];
      if (query.startsWith("sum by (service_name)(rate(http_server_request_duration_seconds_count[5m]))"))
        return [vector({ service_name: "sales-service" }, "10"), vector({ service_name: "catalog-service" }, "0")];
      if (query.includes("histogram_quantile(0.95")) return [vector({ service_name: "sales-service" }, "0.25")];
      if (query.includes("db_client_connection_max")) return [vector({ service_name: "payment-service" }, "20")];
      return [];
    });

    const load = await probeLoad(probes);

    expect(load.map((service) => service.name)).toEqual(["catalog-service", "payment-service", "sales-service"]);
    expect(load.find((service) => service.name === "sales-service")).toEqual({
      name: "sales-service",
      errorRatio: 0.05,
      p95Seconds: 0.25,
      outboxOldestSeconds: null,
      cpuCores: null,
      memoryBytes: null,
      eventLoopLagSeconds: null,
      dbPoolUsed: null,
      dbPoolMax: null,
    });
    // A service with no requests has no ratio, not 0 / 0.
    expect(load.find((service) => service.name === "catalog-service")?.errorRatio).toBeNull();
    expect(load.find((service) => service.name === "payment-service")?.dbPoolMax).toBe(20);
  });
});

describe("probeServiceFacts", () => {
  it("counts instances from the process gauge, reads the latest version and the 24 h uptime", async () => {
    const { probes } = prometheusProbes((query) => {
      if (query.startsWith("count by (service_name)")) return [vector({ service_name: "sales-service" }, "3")];
      if (query.startsWith("topk by (job)"))
        return [
          { metric: { job: "sales-service", service_version: "1.4.2" }, value: [0, "1"] },
          { metric: { job: "catalog-service" }, value: [0, "1"] },
        ];
      if (query.includes("pharmacy_ops_probe_up")) return [vector({ target_service: "sales-service" }, "99.5")];
      return [];
    });

    const facts = await probeServiceFacts(probes);

    expect(facts.get("sales-service")).toEqual({ version: "1.4.2", instances: 3, uptimePercent24h: 99.5 });
    // A service no query returned is absent; the route fills in nulls for it.
    expect(facts.has("catalog-service")).toBe(false);
  });
});
