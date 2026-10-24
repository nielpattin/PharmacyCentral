import { monitorEventLoopDelay } from "node:perf_hooks";
import { metrics } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AmqplibInstrumentation } from "@opentelemetry/instrumentation-amqplib";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  throw new Error(
    "Missing required environment variable: OTEL_EXPORTER_OTLP_ENDPOINT. Please set it in your .env file.",
  );
}

const sdk = new NodeSDK({
  serviceName: "sales-service",
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  // Pino records are exported only when pino is loaded through require() (see src/logger.ts), not an ESM import.
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PinoInstrumentation(),
    new UndiciInstrumentation(),
    new PgInstrumentation(),
    new AmqplibInstrumentation(),
    new IORedisInstrumentation(),
  ],
});

sdk.start();

// Per-process metrics, scraped by Prometheus as pharmacy_process_* (see deploy/local/otel/collector.yaml).
const processMeter = metrics.getMeter("pharmacy-process");
processMeter
  .createObservableCounter("pharmacy.process.cpu", {
    unit: "s",
    description: "User and system CPU time used by this process",
  })
  .addCallback((result) => {
    const usage = process.cpuUsage();
    result.observe((usage.user + usage.system) / 1e6);
  });
processMeter
  .createObservableGauge("pharmacy.process.resident_memory", {
    unit: "By",
    description: "Resident set size of this process",
  })
  .addCallback((result) => result.observe(process.memoryUsage().rss));
const eventLoopDelay = monitorEventLoopDelay();
eventLoopDelay.enable();
processMeter
  .createObservableGauge("pharmacy.process.event_loop_lag", {
    unit: "s",
    description: "p99 event loop delay since the previous collection",
  })
  .addCallback((result) => {
    result.observe(eventLoopDelay.percentile(99) / 1e9);
    eventLoopDelay.reset();
  });

process.once("SIGTERM", () => void sdk.shutdown());
process.once("SIGINT", () => void sdk.shutdown());
