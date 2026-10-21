import { metrics, type BatchObservableResult } from "@opentelemetry/api";
import { sql } from "drizzle-orm";

import type { PaymentDatabase } from "../shared/infrastructure/database.ts";

const meter = metrics.getMeter("payment-service");

const unpublishedGauge = meter.createObservableGauge("pharmacy.outbox.unpublished", {
  description: "Outbox rows not yet published to the broker.",
  unit: "{message}",
});
const oldestAgeGauge = meter.createObservableGauge("pharmacy.outbox.oldest_age", {
  description: "Age of the oldest unpublished outbox row, 0 when none.",
  unit: "s",
});
const publishedCounter = meter.createCounter("pharmacy.outbox.published", {
  description: "Outbox messages the broker confirmed.",
  unit: "{message}",
});
const publishLagHistogram = meter.createHistogram("pharmacy.outbox.publish_lag", {
  description: "Seconds from an outbox row's occurrence to its confirmed publish.",
  unit: "s",
  advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300] },
});

/** Registers the backlog gauges, read with one aggregate query per collection. Returns the function that unregisters them. */
export const registerOutboxBacklogGauges = (database: PaymentDatabase): (() => void) => {
  const observeBacklog = async (result: BatchObservableResult): Promise<void> => {
    let backlog: { unpublished: number; oldest_age: number };
    try {
      const { rows } = await database.db.execute<{ unpublished: number; oldest_age: number }>(sql`
        select count(*)::int as unpublished,
          greatest(extract(epoch from now() - min(occurred_at)), 0)::float8 as oldest_age
        from outbox_messages
        where published_at is null
      `);
      backlog = rows[0] ?? { unpublished: 0, oldest_age: 0 };
    } catch {
      return;
    }
    result.observe(unpublishedGauge, backlog.unpublished);
    result.observe(oldestAgeGauge, backlog.oldest_age);
  };
  const observables = [unpublishedGauge, oldestAgeGauge];
  meter.addBatchObservableCallback(observeBacklog, observables);
  return () => meter.removeBatchObservableCallback(observeBacklog, observables);
};

export const recordOutboxPublished = (occurredAt: Date): void => {
  publishedCounter.add(1);
  publishLagHistogram.record((Date.now() - occurredAt.getTime()) / 1000);
};
