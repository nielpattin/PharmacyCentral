import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentTraceparent, withTraceparent } from "./trace-context.ts";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const spanId = "00f067aa0ba902b7";

/** Span context functions need a context manager; the global one is removed after each test. */
describe("trace context", () => {
  beforeEach(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterEach(() => {
    context.disable();
  });

  it("round-trips the active span context through a traceparent", () => {
    const traceparent = `00-${traceId}-${spanId}-01`;
    const parent = trace.setSpanContext(context.active(), {
      traceId,
      spanId,
      traceFlags: 1,
      isRemote: false,
    });

    const captured = context.with(parent, () => currentTraceparent());
    expect(captured).toBe(traceparent);

    const restored = withTraceparent(captured, () => trace.getSpanContext(context.active()));
    expect(restored).toMatchObject({ traceId, spanId, traceFlags: 1 });
  });

  it("returns null when no valid span context is active", () => {
    expect(currentTraceparent()).toBeNull();
  });

  it("runs without a parent span for null or malformed traceparent values", () => {
    const malformed = [
      `01-${traceId}-${spanId}-01`,
      `00-${traceId.toUpperCase()}-${spanId}-01`,
      `00-${"0".repeat(32)}-${spanId}-01`,
      `00-${traceId}-${spanId}`,
      "not-a-traceparent",
    ];
    for (const value of [null, ...malformed]) {
      expect(withTraceparent(value, () => trace.getSpanContext(context.active()))).toBeUndefined();
    }
  });
});
