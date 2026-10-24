// Availability per step as Tracker data: one block per step, coloured by how much of the step the service was up.
// Pure, so the thresholds can be tested without React.
import type { SystemMetricPoint } from "../../staff-api.ts";
import type { HealthTone } from "./health.ts";

export type TrackerTone = HealthTone | "neutral";

export type TrackerDatum = { key: string; tone: TrackerTone; tooltip: string };

/** Availability is 0..1 per step. At or above 99.9% is healthy, at or above 95% degrades, below that is failing. */
export const AVAILABILITY_OK = 0.999;
export const AVAILABILITY_WARNING = 0.95;

export const availabilityTone = (ratio: number | null): TrackerTone => {
  if (ratio === null) return "neutral";
  if (ratio >= AVAILABILITY_OK) return "ok";
  if (ratio >= AVAILABILITY_WARNING) return "warning";
  return "danger";
};

/**
 * One datum per point, in the server's order. `formatTooltip` gets the step time and the ratio (null when the step has
 * no sample), so the caller decides the wording and units.
 */
export const availabilityTrackerData = (
  points: ReadonlyArray<SystemMetricPoint>,
  formatTooltip: (unixSeconds: number, ratio: number | null) => string,
): TrackerDatum[] =>
  points.map(([time, ratio]) => ({
    key: String(time),
    tone: availabilityTone(ratio),
    tooltip: formatTooltip(time, ratio),
  }));
