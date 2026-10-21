import { context, isSpanContextValid, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { SpanContext } from "@opentelemetry/api";

/** W3C `traceparent` version 00: lowercase hex trace id, span id and flags. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** The `traceparent` of the active span, or null when no valid span context is active. */
export const currentTraceparent = (): string | null => {
  const spanContext = trace.getSpanContext(context.active());
  if (!spanContext || !isSpanContextValid(spanContext)) return null;
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
};

/** Runs `run` with the span described by `traceparent` active, so spans it starts become its children. */
export const withTraceparent = <T>(traceparent: string | null, run: () => T): T => {
  const spanContext = parseTraceparent(traceparent);
  if (!spanContext) return run();
  return context.with(trace.setSpanContext(ROOT_CONTEXT, spanContext), run);
};

const parseTraceparent = (traceparent: string | null): SpanContext | undefined => {
  if (traceparent === null) return undefined;
  const match = TRACEPARENT.exec(traceparent);
  if (!match) return undefined;
  const [, traceId = "", spanId = "", flags = ""] = match;
  const spanContext: SpanContext = {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    isRemote: true,
  };
  return isSpanContextValid(spanContext) ? spanContext : undefined;
};
