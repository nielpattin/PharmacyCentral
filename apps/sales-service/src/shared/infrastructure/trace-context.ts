import { ROOT_CONTEXT, context, trace } from "@opentelemetry/api";

/** W3C `traceparent`: version 00, 32-hex trace id, 16-hex span id, 2-hex flags. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The active span's W3C `traceparent`, or null when no valid span is active. */
export function currentTraceparent(): string | null {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return null;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Runs `run` with the span named by `traceparent` as its parent. A null or malformed value runs `run` without a
 * parent, so a row that predates tracing still publishes.
 */
export function withTraceparent<T>(traceparent: string | null, run: () => T): T {
  const match = traceparent === null ? null : TRACEPARENT.exec(traceparent);
  if (!match) return run();
  const [, traceId = "", spanId = "", flags = "00"] = match;
  const parent = { traceId, spanId, traceFlags: Number.parseInt(flags, 16), isRemote: true };
  if (!trace.isSpanContextValid(parent)) return run();
  return context.with(trace.setSpanContext(ROOT_CONTEXT, parent), run);
}
