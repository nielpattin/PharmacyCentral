import { metrics, type BatchObservableResult } from "@opentelemetry/api";
import { isNull, sql } from "drizzle-orm";

import type { SalesDatabase } from "../shared/infrastructure/database.ts";
import { outboxMessages } from "../shared/infrastructure/schema.ts";

const meter = metrics.getMeter("sales-service");

const unpublished = meter.createObservableGauge("pharmacy.outbox.unpublished", {
  description: "Outbox rows not yet published to the broker.",
  unit: "{message}",
});
const oldestAge = meter.createObservableGauge("pharmacy.outbox.oldest_age", {
  description: "Age of the oldest unpublished outbox row, 0 when none.",
  unit: "s",
});
const published = meter.createCounter("pharmacy.outbox.published", {
  description: "Outbox rows the broker confirmed.",
  unit: "{message}",
});
const publishLag = meter.createHistogram("pharmacy.outbox.publish_lag", {
  description: "Seconds from an outbox row's occurrence to its confirmed publish.",
  unit: "s",
  advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300] },
});

export const recordOutboxPublished = (occurredAt: Date): void => {
  published.add(1);
  publishLag.record((Date.now() - occurredAt.getTime()) / 1000);
};

const ageSeconds = sql<number>`coalesce(extract(epoch from now() - min(${outboxMessages.occurredAt})), 0)::float8`;

/**
 * Registers the backlog gauges. The SDK awaits the callback once per export interval, and both values come from one
 * aggregate query; a failed query leaves them unobserved for that interval. Returns the function that unregisters.
 */
export const observeOutboxBacklog = (database: SalesDatabase): (() => void) => {
  const observe = async (result: BatchObservableResult): Promise<void> => {
    try {
      const [row] = await database.db
        .select({
          unpublished: sql<number>`count(*)::int`,
          oldestAgeSeconds: ageSeconds,
        })
        .from(outboxMessages)
        .where(isNull(outboxMessages.publishedAt));
      if (!row) return;
      result.observe(unpublished, row.unpublished);
      result.observe(oldestAge, row.oldestAgeSeconds);
    } catch {
      // Left unobserved this interval: an export must never fail because the database is slow or down.
    }
  };
  const observables = [unpublished, oldestAge];
  meter.addBatchObservableCallback(observe, observables);
  return () => meter.removeBatchObservableCallback(observe, observables);
};
