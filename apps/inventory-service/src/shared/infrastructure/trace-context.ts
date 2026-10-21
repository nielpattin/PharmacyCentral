import { context, ROOT_CONTEXT, trace, type SpanContext } from "@opentelemetry/api";

/** W3C `traceparent`: version 00, 32-hex trace id, 16-hex parent id, 2-hex flags. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The `traceparent` of the active span, or null when no valid span is active. */
export function currentTraceparent(): string | null {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return null;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/** Runs `run` with the span described by `traceparent` active as a remote parent. Malformed input runs without one. */
export function withTraceparent<T>(traceparent: string | null, run: () => T): T {
  const remote = parseTraceparent(traceparent);
  if (!remote) return run();
  return context.with(trace.setSpanContext(ROOT_CONTEXT, remote), run);
}

function parseTraceparent(traceparent: string | null): SpanContext | null {
  const match = traceparent === null ? null : TRACEPARENT.exec(traceparent);
  if (!match) return null;
  const spanContext: SpanContext = {
    traceId: match[1]!,
    spanId: match[2]!,
    traceFlags: parseInt(match[3]!, 16),
    isRemote: true,
  };
  return trace.isSpanContextValid(spanContext) ? spanContext : null;
}
