import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("sales-service");

const calculationDuration = meter.createHistogram("pharmacy.delivery.calculation.duration", {
  description: "Time to calculate one delivery quote, including cache lookup and provider calls",
  unit: "s",
  advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30] },
});

const cacheLookups = meter.createCounter("pharmacy.delivery.cache", {
  description: "Delivery quote cache lookups by result",
  unit: "{lookup}",
});

export type DeliveryCalculationOutcome = "ok" | "out_of_range" | "provider_error";

export const recordDeliveryCalculation = (outcome: DeliveryCalculationOutcome, seconds: number): void => {
  calculationDuration.record(seconds, { outcome });
};

export const recordDeliveryCacheLookup = (result: "hit" | "miss"): void => {
  cacheLookups.add(1, { result });
};
