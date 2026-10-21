import { metrics } from "@opentelemetry/api";

export type ConsumerOutcome = "processed" | "duplicate" | "retried" | "dead_lettered";

const OUTCOMES: readonly ConsumerOutcome[] = ["processed", "duplicate", "retried", "dead_lettered"];

const meter = metrics.getMeter("operations-query-service");

const messages = meter.createCounter("pharmacy.consumer.messages", {
  unit: "{message}",
  description: "RabbitMQ deliveries settled by the consumer, by outcome.",
});

const duration = meter.createHistogram("pharmacy.consumer.duration", {
  unit: "s",
  description: "Time spent handling one RabbitMQ delivery.",
  advice: { explicitBucketBoundaries: [0.005, 0.025, 0.1, 0.5, 1, 5] },
});

/**
 * Prometheus cannot see the first increment of a counter series: `increase()` needs an earlier sample. Recording a zero
 * for every outcome when the consumer starts means the first failure is already an increase, so the alerts see it.
 */
export function initConsumerOutcomes(queue: string): void {
  for (const outcome of OUTCOMES) messages.add(0, { queue, outcome });
}

export function recordConsumerDelivery(queue: string, outcome: ConsumerOutcome, startedAt: number): void {
  messages.add(1, { queue, outcome });
  duration.record((performance.now() - startedAt) / 1000, { queue });
}
