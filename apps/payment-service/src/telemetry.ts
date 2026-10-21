import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AmqplibInstrumentation } from "@opentelemetry/instrumentation-amqplib";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  throw new Error(
    "Missing required environment variable: OTEL_EXPORTER_OTLP_ENDPOINT. Please set it in your .env file.",
  );

const sdk = new NodeSDK({
  serviceName: "payment-service",
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
  ],
});

sdk.start();

process.once("SIGTERM", () => void sdk.shutdown());
process.once("SIGINT", () => void sdk.shutdown());
