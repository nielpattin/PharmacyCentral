/** Request duration histogram emitted by every service's HTTP server instrumentation. */
export const HTTP_DURATION = "http_server_request_duration_seconds";

/** Service selector value for the aggregate across the configured services (`/system/metrics/range?service=all`). */
export const ALL_SERVICES = "all";

/** A PromQL range selector: `[range]`, optionally shifted back by `offset` (both seconds). */
export type Span = { range: number; offset?: number | undefined };

export const spanClause = (span: Span): string => `[${span.range}s]${span.offset ? ` offset ${span.offset}s` : ""}`;

/** Rates need a few samples in the window: the OTLP export is every 60 s, so 5 minutes is the floor. */
export const rateSpan = (stepSeconds: number, offset?: number): Span => ({
  range: Math.max(300, 4 * stepSeconds),
  offset,
});

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Label matcher for the services to read. A single name matches exactly; ALL_SERVICES matches the configured names
 * only, so the aggregate never picks up other emitters (the ops console's own traffic, for one). JSON.stringify writes
 * a valid PromQL string literal.
 */
export const selectorFor = (service: string, configured: readonly string[]): string =>
  service === ALL_SERVICES
    ? `service_name=~${JSON.stringify(configured.map(escapeRegex).join("|"))}`
    : `service_name=${JSON.stringify(service)}`;
