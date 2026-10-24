import { describe, expect, it } from "vitest";

import type { Probes } from "./probes.ts";
import { probeMetricsSummary } from "./summary.ts";

const NAMES = ["sales-service", "catalog-service"];
const NOW = new Date("2026-10-24T03:00:37.000Z");

type Recorded = { query: string; start: number | null; end: number | null; step: number | null };
type Matrix = { metric: Record<string, string>; values: [number, string][] };

/** Answers range queries from `range(query, start)`. Every answer is a Prometheus JSON envelope. */
const prometheus = (range: (query: string, start: number) => Matrix[]): { probes: Probes; recorded: Recorded[] } => {
  const recorded: Recorded[] = [];
  const probes = {
    services: NAMES.map((name) => ({ name, url: "", healthPath: "", livePath: "" })),
    prometheusUrl: "http://prometheus.test",
    rabbitmq: { url: "", user: "", password: "" },
    typesense: { url: "", apiKey: "" },
    timeoutMs: 500,
    queryTimeoutMs: 500,
    fetch: ((input: string | URL) => {
      const url = new URL(input.toString());
      const query = url.searchParams.get("query") ?? "";
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const step = url.searchParams.get("step");
      recorded.push({
        query,
        start: start === null ? null : Number(start),
        end: end === null ? null : Number(end),
        step: step === null ? null : Number(step),
      });
      const body = {
        status: "success",
        data: { resultType: "matrix", result: range(query, Number(start)) },
      };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch,
  } as Probes;
  return { probes, recorded };
};

describe("probeMetricsSummary", () => {
  it("reads the probe gauge in one range query grouped by target, aligned to one grid", async () => {
    const { probes, recorded } = prometheus(() => []);
    const summary = await probeMetricsSummary(probes, 15, NOW);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.query).toContain("by (target_service)");
    expect(summary.stepSeconds).toBe(15);
    expect(summary.to % summary.stepSeconds).toBe(0);
    expect(summary.to - summary.from).toBe(15 * 60);
    expect(recorded[0]).toMatchObject({ step: 15, start: summary.from, end: summary.to });
    expect(summary.services["sales-service"]?.availability).toHaveLength(61);
  });

  it("uses a 60-second step for a 60-minute window", async () => {
    const { probes } = prometheus(() => []);
    const summary = await probeMetricsSummary(probes, 60, NOW);
    expect(summary.stepSeconds).toBe(60);
    expect(summary.services["catalog-service"]?.availability).toHaveLength(61);
  });

  it("reads availability as the average of the probe gauge per step, keyed by the probed target", async () => {
    const { probes } = prometheus((query, start) => {
      if (!query.includes("pharmacy_ops_probe_up")) return [];
      return [{ metric: { target_service: "catalog-service" }, values: [[start, "0.5"]] }];
    });
    const summary = await probeMetricsSummary(probes, 15, NOW);
    expect(summary.services["catalog-service"]?.availability[0]).toEqual([summary.from, 0.5]);
    expect(summary.services["sales-service"]?.availability[0]).toEqual([summary.from, null]);
  });

  it("throws when Prometheus answers an error, so the route can answer 502", async () => {
    const probes = {
      services: [],
      prometheusUrl: "http://prometheus.test",
      rabbitmq: { url: "", user: "", password: "" },
      typesense: { url: "", apiKey: "" },
      timeoutMs: 500,
      queryTimeoutMs: 500,
      fetch: (() => Promise.resolve(new Response("{}", { status: 503 }))) as typeof fetch,
    } as Probes;
    await expect(probeMetricsSummary(probes, 15, NOW)).rejects.toThrow("prometheus answered 503");
  });
});
