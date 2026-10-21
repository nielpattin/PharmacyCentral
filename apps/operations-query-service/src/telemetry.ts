import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { AmqplibInstrumentation } from "@opentelemetry/instrumentation-amqplib";

if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  throw new Error(
    "Missing required environment variable: OTEL_EXPORTER_OTLP_ENDPOINT. Please set it in your .env file.",
  );

const sdk = new NodeSDK({
  serviceName: "operations-query-service",
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new PinoInstrumentation(),
    new PgInstrumentation(),
    new AmqplibInstrumentation(),
  ],
});

sdk.start();

process.once("SIGTERM", () => void sdk.shutdown());
process.once("SIGINT", () => void sdk.shutdown());
