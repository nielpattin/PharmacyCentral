import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.ts";
import { signedIdentityHeader } from "../../middleware/platform-admin.test.ts";
import type { Probes } from "./probes.ts";

const SECRET = "test-internal-identity-secret";
const AUDIENCE = "ops-console-service";
const admin = { "x-internal-identity-context": signedIdentityHeader(SECRET, AUDIENCE, "employee", ["Platform Admin"]) };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const flags = { rabbitDown: false, prometheusDown: false };

/** Instant answers by PromQL. Every series carries the labels the real queries group by. */
type InstantSample = { metric: Record<string, string>; value: [number, string] };
const instantValue = (query: string): InstantSample[] => {
  const one = (metric: Record<string, string>, value: string): InstantSample[] => [{ metric, value: [0, value] }];
  const sales = { service_name: "sales-service" };
  if (query.startsWith("count by (service_name)(pharmacy_process")) return one({ service_name: "sales-service" }, "2");
  if (query.startsWith("topk by (job)")) return one({ job: "sales-service", service_version: "1.4.2" }, "1");
  if (query.includes("pharmacy_ops_probe_up")) return one({ target_service: "sales-service" }, "99.5");
  if (query.includes('http_response_status_code=~"5.."')) return one(sales, "0.5");
  if (query.startsWith("sum by (service_name)(rate(http_server_request_duration_seconds_count[5m]))"))
    return one(sales, "20");
  if (query.includes("histogram_quantile(0.95")) return one(sales, "0.25");
  if (query.includes("pharmacy_outbox_oldest")) return one(sales, "12.5");
  if (query.includes("pharmacy_process_cpu_seconds_total")) return one(sales, "0.3");
  if (query.includes("pharmacy_process_resident_memory_bytes")) return one(sales, "104857600");
  if (query.includes("pharmacy_process_event_loop_lag_seconds")) return one(sales, "0.02");
  if (query.includes('db_client_connection_state="used"')) return one(sales, "4");
  if (query.includes("db_client_connection_max")) return one(sales, "10");
  return [];
};

const fakeFetch = ((input: string | URL) => {
  const url = new URL(input.toString());
  if (url.host === "rabbit.test")
    return Promise.resolve(
      flags.rabbitDown
        ? json({}, 503)
        : json([
            { name: "sales.payment-events.v2", messages_ready: 3, messages_unacknowledged: 1, consumers: 2 },
            { name: "catalog.availability.v2.dead", messages_ready: 5, consumers: 0 },
          ]),
    );
  if (url.host === "typesense.test")
    return Promise.resolve(json([{ name: "catalog_products_v3", num_documents: 10120 }]));
  if (url.host === "prometheus.test") {
    if (flags.prometheusDown) return Promise.resolve(json({ status: "error", error: "down" }, 503));
    const query = url.searchParams.get("query") ?? "";
    if (url.pathname === "/api/v1/query_range") {
      const now = Math.floor(Date.now() / 60_000) * 60;
      return Promise.resolve(
        json({
          status: "success",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { service_name: "sales-service" },
                values: [
                  [now - 60, "20"],
                  [now, "21"],
                ],
              },
            ],
          },
        }),
      );
    }
    return Promise.resolve(json({ status: "success", data: { resultType: "vector", result: instantValue(query) } }));
  }
  if (url.host === "sales.test") return Promise.resolve(json({ status: "ok" }));
  return Promise.reject(new Error("connection refused"));
}) as typeof fetch;

const baseProbes: Probes = {
  services: [
    { name: "sales-service", url: "http://sales.test", healthPath: "/health/ready", livePath: "/health/live" },
    { name: "payment-service", url: "http://payment.test", healthPath: "/health/ready", livePath: "/health/live" },
  ],
  prometheusUrl: "http://prometheus.test",
  rabbitmq: { url: "http://rabbit.test", user: "guest", password: "guest" },
  typesense: { url: "http://typesense.test", apiKey: "key" },
  timeoutMs: 500,
  queryTimeoutMs: 500,
  fetch: fakeFetch,
};

const startServer = async (probes: Probes): Promise<{ base: string; close: () => Promise<void> }> => {
  const app = createApp({
    identitySecret: SECRET,
    audience: AUDIENCE,
    probes,
    links: [{ label: "Grafana", url: "http://grafana.test" }],
    logger: pino({ level: "silent" }),
  });
  const listening = Promise.withResolvers<AddressInfo>();
  const server: Server = app.listen(0, "127.0.0.1", () => listening.resolve(server.address() as AddressInfo));
  const { port } = await listening.promise;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
};

let configured: { base: string; close: () => Promise<void> };

beforeAll(async () => {
  configured = await startServer(baseProbes);
});

afterAll(async () => {
  await configured.close();
});

type Section = { status: string; data?: unknown; error?: string };
type Overview = {
  services: Section;
  load: Section;
  queues: Section;
  searchIndex: Section;
  links: unknown;
};

const get = (base: string, path: string, headers: Record<string, string> = admin) =>
  fetch(`${base}${path}`, { headers });

describe("GET /system/overview", () => {
  it("combines health, load, queues, the search index and the links", async () => {
    const response = await get(configured.base, "/system/overview");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Overview;
    expect(body.services).toEqual({
      status: "ok",
      data: [
        {
          name: "sales-service",
          status: "up",
          httpStatus: 200,
          latencyMs: expect.any(Number) as number,
          liveStatus: "up",
          liveHttpStatus: 200,
          version: "1.4.2",
          instances: 2,
          uptimePercent24h: 99.5,
        },
        {
          name: "payment-service",
          status: "down",
          httpStatus: null,
          latencyMs: null,
          liveStatus: "down",
          liveHttpStatus: null,
          version: null,
          instances: null,
          uptimePercent24h: null,
        },
      ],
    });
    expect(body.load.data).toEqual([
      {
        name: "sales-service",
        errorRatio: 0.025,
        p95Seconds: 0.25,
        outboxOldestSeconds: 12.5,
        cpuCores: 0.3,
        memoryBytes: 104857600,
        eventLoopLagSeconds: 0.02,
        dbPoolUsed: 4,
        dbPoolMax: 10,
      },
    ]);
    expect(body.queues.data).toEqual([
      { name: "catalog.availability.v2.dead", ready: 5, unacknowledged: 0, consumers: 0, deadLetter: true },
      { name: "sales.payment-events.v2", ready: 3, unacknowledged: 1, consumers: 2, deadLetter: false },
    ]);
    expect(body.searchIndex.data).toEqual([{ name: "catalog_products_v3", documents: 10120 }]);
    expect(body.links).toEqual([{ label: "Grafana", url: "http://grafana.test" }]);
  });

  it("keeps the health grid when Prometheus is down, with the facts as null, and marks only the load section", async () => {
    flags.prometheusDown = true;
    try {
      const body = (await (await get(configured.base, "/system/overview")).json()) as Overview;
      expect(body.load.status).toBe("unavailable");
      expect(body.services.status).toBe("ok");
      const [sales] = (body.services.data as { version: unknown; name: string }[]) ?? [];
      expect(sales?.name).toBe("sales-service");
      expect(sales?.version).toBeNull();
    } finally {
      flags.prometheusDown = false;
    }
  });

  it("reports one failing source as unavailable and still answers with the others", async () => {
    flags.rabbitDown = true;
    try {
      const response = await get(configured.base, "/system/overview");
      const body = (await response.json()) as Overview;
      expect(response.status).toBe(200);
      expect(body.queues).toEqual({ status: "unavailable", error: "rabbit.test answered 503" });
      expect(body.searchIndex.status).toBe("ok");
    } finally {
      flags.rabbitDown = false;
    }
  });
});

describe("GET /system/metrics/summary", () => {
  it("returns the availability grid per configured service", async () => {
    const response = await get(configured.base, "/system/metrics/summary?windowMinutes=15");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      from: number;
      to: number;
      stepSeconds: number;
      services: Record<string, { availability: [number, number | null][] }>;
    };
    expect(body.stepSeconds).toBe(15);
    expect(body.to - body.from).toBe(900);
    expect(Object.keys(body.services).sort()).toEqual(["payment-service", "sales-service"]);
    expect(body.services["sales-service"]?.availability).toHaveLength(61);
  });

  it("refuses an unsupported window with 400 invalid_request, and answers 502 when Prometheus is down", async () => {
    const bad = await get(configured.base, "/system/metrics/summary?windowMinutes=5");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ status: 400, code: "invalid_request" });

    flags.prometheusDown = true;
    try {
      const response = await get(configured.base, "/system/metrics/summary?windowMinutes=60");
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: "prometheus_unavailable" });
    } finally {
      flags.prometheusDown = false;
    }
  });
});

describe("GET /system/metrics/range", () => {
  it("returns the aligned series for a configured service", async () => {
    const response = await get(configured.base, "/system/metrics/range?service=sales-service&windowMinutes=15");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      service: string;
      from: number;
      to: number;
      stepSeconds: number;
      series: Record<string, [number, number | null][]>;
    };
    expect(body.service).toBe("sales-service");
    expect(body.stepSeconds).toBe(60);
    expect(body.to - body.from).toBe(900);
    expect(Object.keys(body.series).sort()).toEqual(["cpuCores", "eventLoopLagSeconds", "memoryBytes"]);
    const memory = body.series.memoryBytes ?? [];
    expect(memory).toHaveLength(16);
    expect(memory.filter(([, value]) => value !== null)).toHaveLength(2);
  });

  it("refuses an unknown service and an unsupported window with 400 invalid_request", async () => {
    for (const query of [
      "service=nope-service&windowMinutes=15",
      "service=sales-service&windowMinutes=5",
      "service=sales-service",
    ]) {
      const response = await get(configured.base, `/system/metrics/range?${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ status: 400, code: "invalid_request" });
    }
  });

  it("answers 502 prometheus_unavailable when Prometheus is down", async () => {
    flags.prometheusDown = true;
    try {
      const response = await get(configured.base, "/system/metrics/range?service=sales-service&windowMinutes=60");
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: "prometheus_unavailable" });
    } finally {
      flags.prometheusDown = false;
    }
  });
});

describe("access", () => {
  it("refuses a request without a trusted identity", async () => {
    expect((await get(configured.base, "/system/overview", {})).status).toBe(401);
  });

  it("refuses a customer, a manager and a system actor with 403", async () => {
    for (const [actorType, roles] of [
      ["customer", []],
      ["employee", ["Pharmacy Manager"]],
      ["system", ["Platform Admin"]],
    ] as const) {
      const response = await get(configured.base, "/system/overview", {
        "x-internal-identity-context": signedIdentityHeader(SECRET, AUDIENCE, actorType, [...roles]),
      });
      expect(response.status, `${actorType} ${roles.join()}`).toBe(403);
    }
  });

  it("keeps the health probes open", async () => {
    expect((await fetch(`${configured.base}/health/ready`)).status).toBe(200);
  });
});
