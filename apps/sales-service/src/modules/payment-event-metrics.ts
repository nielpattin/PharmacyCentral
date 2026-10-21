import { metrics } from "@opentelemetry/api";

export type ConsumerOutcome = "processed" | "retried" | "dead_lettered";

const OUTCOMES: readonly ConsumerOutcome[] = ["processed", "retried", "dead_lettered"];

const meter = metrics.getMeter("sales-service");

const messages = meter.createCounter("pharmacy.consumer.messages", {
  unit: "{message}",
  description: "Deliveries settled by a RabbitMQ consumer, by outcome",
});

const duration = meter.createHistogram("pharmacy.consumer.duration", {
  unit: "s",
  description: "Time spent handling one delivery",
  advice: { explicitBucketBoundaries: [0.005, 0.025, 0.1, 0.5, 1, 5] },
});

/**
 * Prometheus cannot see the first increment of a counter series: `increase()` needs an earlier sample. Recording a zero
 * for every outcome when the consumer starts means the first failure is already an increase, so the alerts see it.
 */
export const initConsumerOutcomes = (queue: string): void => {
  for (const outcome of OUTCOMES) messages.add(0, { queue, outcome });
};

export const recordConsumerDelivery = (queue: string, outcome: ConsumerOutcome, seconds: number): void => {
  messages.add(1, { queue, outcome });
  duration.record(seconds, { queue });
};
