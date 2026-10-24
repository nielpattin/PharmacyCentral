import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it } from "vitest";

import { createProbeLoop, type ProbeLoop } from "./probe-loop.ts";
import type { Probes, ServiceTarget } from "./probes.ts";

const services: ServiceTarget[] = [
  { name: "sales-service", url: "http://sales.test", healthPath: "/health/ready", livePath: "/health/live" },
  { name: "payment-service", url: "http://payment.test", healthPath: "/health/ready", livePath: "/health/live" },
  { name: "catalog-service", url: "http://catalog.test", healthPath: "/health/ready", livePath: "/health/live" },
];

type Answer = { status: number } | "refused";

const setup = (answers: Record<string, Answer>) => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
  const provider = new MeterProvider({ readers: [reader] });
  const requested: string[] = [];
  const probes: Probes = {
    services,
    prometheusUrl: "",
    rabbitmq: { url: "", user: "", password: "" },
    typesense: { url: "", apiKey: "" },
    timeoutMs: 500,
    queryTimeoutMs: 500,
    fetch: ((input: string | URL) => {
      const url = input.toString();
      requested.push(url);
      const answer = answers[url];
      if (answer === undefined || answer === "refused") return Promise.reject(new Error("connection refused"));
      return Promise.resolve(new Response("", { status: answer.status }));
    }) as typeof fetch,
  };
  const loop: ProbeLoop = createProbeLoop({
    probes,
    intervalMs: 15_000,
    meter: provider.getMeter("ops-console-service"),
  });
  return { loop, reader, exporter, provider, requested };
};

/** Flushes the reader and returns the probe gauge as target_service -> value. */
const gaugeValues = async (
  reader: PeriodicExportingMetricReader,
  exporter: InMemoryMetricExporter,
): Promise<Record<string, number>> => {
  exporter.reset();
  await reader.forceFlush();
  const values: Record<string, number> = {};
  for (const resource of exporter.getMetrics()) {
    for (const scope of resource.scopeMetrics) {
      for (const metric of scope.metrics) {
        if (metric.descriptor.name !== "pharmacy_ops_probe_up") continue;
        for (const point of metric.dataPoints) {
          values[String(point.attributes.target_service)] = Number(point.value);
        }
      }
    }
  }
  return values;
};

describe("probe loop", () => {
  let active: { provider: MeterProvider; loop: ProbeLoop } | undefined;
  afterEach(async () => {
    active?.loop.stop();
    await active?.provider.shutdown();
    active = undefined;
  });

  it("exports 1 for a ready service and 0 for a refused or unhealthy one", async () => {
    const env = setup({
      "http://sales.test/health/ready": { status: 200 },
      "http://payment.test/health/ready": { status: 503 },
      // catalog is refused
    });
    active = env;
    await env.loop.runOnce();
    expect(await gaugeValues(env.reader, env.exporter)).toEqual({
      "sales-service": 1,
      "payment-service": 0,
      "catalog-service": 0,
    });
  });

  it("probes /health/ready only, one request per service per round", async () => {
    const env = setup({ "http://sales.test/health/ready": { status: 200 } });
    active = env;
    await env.loop.runOnce();
    expect(env.requested.sort()).toEqual([
      "http://catalog.test/health/ready",
      "http://payment.test/health/ready",
      "http://sales.test/health/ready",
    ]);
  });

  it("reports the latest round, so a service that recovers goes back to 1", async () => {
    const answers: Record<string, Answer> = { "http://sales.test/health/ready": { status: 503 } };
    const env = setup(answers);
    active = env;
    await env.loop.runOnce();
    answers["http://sales.test/health/ready"] = { status: 200 };
    await env.loop.runOnce();
    expect((await gaugeValues(env.reader, env.exporter))["sales-service"]).toBe(1);
  });
});
