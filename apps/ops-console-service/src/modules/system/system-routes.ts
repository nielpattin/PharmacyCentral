import { Router } from "express";
import { z } from "zod";

import { probeLoad, probeMetricsRange, probeServiceFacts, type ServiceFacts, type ServiceLoad } from "./prometheus.ts";
import { problem, windowMinutes } from "./http.ts";
import { ALL_SERVICES } from "./promql.ts";
import { probeMetricsSummary, type MetricsSummary } from "./summary.ts";
import {
  probeQueues,
  probeSearchIndex,
  probeServices,
  settle,
  type Probes,
  type QueueDepth,
  type SearchCollection,
  type ServiceProbe,
} from "./probes.ts";

export type DashboardLink = { label: string; url: string };

export type ServiceHealth = ServiceProbe & ServiceFacts;

export type Overview = {
  generatedAt: string;
  services: { status: "ok"; data: ServiceHealth[] } | { status: "unavailable"; error: string };
  load: { status: "ok"; data: ServiceLoad[] } | { status: "unavailable"; error: string };
  queues: { status: "ok"; data: QueueDepth[] } | { status: "unavailable"; error: string };
  searchIndex: { status: "ok"; data: SearchCollection[] } | { status: "unavailable"; error: string };
  links: DashboardLink[];
};

/** Facts are optional for the grid: when Prometheus cannot answer, the health probes still show and facts read as null. */
const probeServiceHealth = async (probes: Probes): Promise<ServiceHealth[]> => {
  const [probed, facts] = await Promise.all([probeServices(probes), settle(() => probeServiceFacts(probes))]);
  const factsByName = facts.status === "ok" ? facts.data : new Map<string, ServiceFacts>();
  return probed.map((service) => ({
    ...service,
    ...(factsByName.get(service.name) ?? { version: null, instances: null, uptimePercent24h: null }),
  }));
};

export const createSystemRouter = (probes: Probes, links: DashboardLink[]): Router => {
  const router = Router();
  const serviceNames = new Set(probes.services.map((service) => service.name));

  const serviceWindowQuery = z.object({
    service: z
      .string()
      .refine((name) => name === ALL_SERVICES || serviceNames.has(name), { message: "unknown service" }),
    windowMinutes,
  });
  const windowQuery = z.object({ windowMinutes });

  router.get("/system/overview", async (_request, response) => {
    const [services, load, queues, searchIndex] = await Promise.all([
      settle(() => probeServiceHealth(probes)),
      settle(() => probeLoad(probes)),
      settle(() => probeQueues(probes)),
      settle(() => probeSearchIndex(probes)),
    ]);
    const overview: Overview = {
      generatedAt: new Date().toISOString(),
      services,
      load,
      queues,
      searchIndex,
      links,
    };
    response.setHeader("Cache-Control", "no-store");
    response.json(overview);
  });

  router.get("/system/metrics/summary", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const parsed = windowQuery.safeParse(request.query);
    if (!parsed.success) {
      problem(response, 400, "Invalid request", "invalid_request");
      return;
    }
    try {
      const summary: MetricsSummary = await probeMetricsSummary(probes, parsed.data.windowMinutes, new Date());
      response.json(summary);
    } catch {
      problem(response, 502, "Prometheus is unavailable", "prometheus_unavailable");
    }
  });

  router.get("/system/metrics/range", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const parsed = serviceWindowQuery.safeParse(request.query);
    if (!parsed.success) {
      problem(response, 400, "Invalid request", "invalid_request");
      return;
    }
    try {
      const range = await probeMetricsRange(probes, parsed.data.service, parsed.data.windowMinutes, new Date());
      response.json(range);
    } catch {
      problem(response, 502, "Prometheus is unavailable", "prometheus_unavailable");
    }
  });

  return router;
};
