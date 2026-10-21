import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("payment-service");

export const sePayWebhookRequests = meter.createCounter("pharmacy.payment.webhook", {
  unit: "{request}",
  description: "SePay webhook requests by outcome",
});

const OUTCOMES = ["accepted", "duplicate", "invalid_signature", "invalid_payload", "unmatched", "error"] as const;

// Prometheus cannot see the first increment of a counter series, so the alert on `error` would miss the first failure.
for (const outcome of OUTCOMES) sePayWebhookRequests.add(0, { outcome });
