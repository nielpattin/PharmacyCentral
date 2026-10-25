import { context, trace, TraceFlags } from "@opentelemetry/api";
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

  it("returns null when no valid span is active", () => {
    expect(currentTraceparent()).toBeNull();
  });

  it("round-trips the active span through a traceparent header", () => {
    const sampled = trace.setSpanContext(context.active(), {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
    });
    const header = context.with(sampled, () => currentTraceparent());
    expect(header).toBe(`00-${traceId}-${spanId}-01`);

    const remote = withTraceparent(header, () => trace.getSpanContext(context.active()));
    expect(remote).toMatchObject({ traceId, spanId, traceFlags: TraceFlags.SAMPLED, isRemote: true });
  });

  it("keeps unsampled flags as 00", () => {
    const unsampled = trace.setSpanContext(context.active(), { traceId, spanId, traceFlags: TraceFlags.NONE });
    expect(context.with(unsampled, () => currentTraceparent())).toBe(`00-${traceId}-${spanId}-00`);
  });

  it.each([
    ["null", null],
    ["not a header", "not-a-traceparent"],
    ["uppercase hex", `00-${traceId.toUpperCase()}-${spanId}-01`],
    ["wrong version", `01-${traceId}-${spanId}-01`],
    ["short trace id", `00-${traceId.slice(1)}-${spanId}-01`],
    ["all-zero trace id", `00-${"0".repeat(32)}-${spanId}-01`],
    ["all-zero span id", `00-${traceId}-${"0".repeat(16)}-01`],
  ])("runs without a parent for %s", (_label, header) => {
    const active = withTraceparent(header, () => trace.getSpanContext(context.active()));
    expect(active).toBeUndefined();
  });
});
