import "./telemetry.ts"; // Must load first so the instrumentations can patch libraries.
import { createServer } from "node:http";

import { metrics } from "@opentelemetry/api";
import { z } from "zod";

import { createApp } from "./app.ts";
import { createLogger } from "./logger.ts";
import { createProbeLoop, PROBE_INTERVAL_MS } from "./modules/system/probe-loop.ts";
import type { Probes, ServiceTarget } from "./modules/system/probes.ts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  }
  return value;
};

const parsedPort = z.coerce.number().int().min(1).max(65535).safeParse(requireEnv("PORT"));
if (!parsedPort.success) {
  throw new Error("Invalid environment variable: PORT must be an integer from 1 to 65535.");
}

const target = (
  name: string,
  urlVariable: string,
  healthPath = "/health/ready",
  livePath = "/health/live",
): ServiceTarget => ({
  name,
  url: requireEnv(urlVariable),
  healthPath,
  livePath,
});

const probes: Probes = {
  services: [
    target("identity-service", "IDENTITY_SERVICE_URL"),
    target("catalog-service", "CATALOG_SERVICE_URL"),
    target("search-service", "SEARCH_SERVICE_URL", "/healthz", "/healthz"),
    target("inventory-service", "INVENTORY_SERVICE_URL"),
    target("sales-service", "SALES_SERVICE_URL"),
    target("payment-service", "PAYMENT_SERVICE_URL"),
    target("chatbot-service", "CHATBOT_SERVICE_URL"),
    target("operations-query-service", "OPERATIONS_QUERY_SERVICE_URL"),
  ],
  prometheusUrl: requireEnv("PROMETHEUS_URL"),
  rabbitmq: {
    url: requireEnv("RABBITMQ_MANAGEMENT_URL"),
    user: requireEnv("RABBITMQ_MANAGEMENT_USER"),
    password: requireEnv("RABBITMQ_MANAGEMENT_PASSWORD"),
  },
  typesense: { url: requireEnv("TYPESENSE_URL"), apiKey: requireEnv("TYPESENSE_API_KEY") },
  timeoutMs: 2_000,
  queryTimeoutMs: 10_000,
  fetch,
};

const logger = createLogger();
const app = createApp({
  identitySecret: requireEnv("INTERNAL_IDENTITY_SECRET"),
  audience: "ops-console-service",
  probes,
  links: [{ label: "Grafana", url: requireEnv("GRAFANA_PUBLIC_URL") }],
  logger,
});
const server = createServer(app);

// Exports pharmacy_ops_probe_up through the same OTLP metrics pipeline telemetry.ts starts.
const probeLoop = createProbeLoop({
  probes,
  intervalMs: PROBE_INTERVAL_MS,
  meter: metrics.getMeter("ops-console-service"),
});

const shutdown = (signal: string): void => {
  probeLoop.stop();
  server.close((error) => {
    if (error) {
      logger.error({ error, signal }, "service shutdown failed");
      process.exitCode = 1;
    }
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(parsedPort.data, "0.0.0.0", () => {
  logger.info({ port: parsedPort.data }, "service listening");
  probeLoop.start();
});
