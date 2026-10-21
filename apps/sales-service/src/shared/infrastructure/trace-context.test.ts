import { ROOT_CONTEXT, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentTraceparent, withTraceparent } from "./trace-context.ts";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const spanId = "00f067aa0ba902b7";

describe("trace context", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  it("round-trips the active span through a traceparent", () => {
    const active = trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId, traceFlags: 1, isRemote: false });
    const traceparent = context.with(active, () => currentTraceparent());

    expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);
    const restored = withTraceparent(traceparent, () => trace.getSpanContext(context.active()));
    expect(restored?.traceId).toBe(traceId);
    expect(restored?.spanId).toBe(spanId);
    expect(restored?.traceFlags).toBe(1);
  });

  it("has no traceparent without an active span", () => {
    expect(currentTraceparent()).toBeNull();
  });

  it("runs without a parent for null or malformed values", () => {
    const malformed = [
      null,
      "",
      "garbage",
      `01-${traceId}-${spanId}-01`,
      `00-${traceId.toUpperCase()}-${spanId}-01`,
      `00-${"0".repeat(32)}-${spanId}-01`,
      `00-${traceId}-${"0".repeat(16)}-01`,
      `00-${traceId}-${spanId}-1`,
    ];
    for (const value of malformed) {
      expect(withTraceparent(value, () => trace.getSpanContext(context.active()))).toBeUndefined();
    }
  });

  it("returns the value of the run callback", () => {
    expect(withTraceparent(null, () => 42)).toBe(42);
  });
});
