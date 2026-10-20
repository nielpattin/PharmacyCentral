import { describe, expect, it } from "vitest";

import type { IntentVerdict } from "../../domain/intent-gate.ts";
import {
  EMERGENCY_THRESHOLD,
  GATE_REPLIES,
  INJECTION_THRESHOLD,
  INTENT_CONFIDENCE_THRESHOLD,
  decideGate,
} from "./intent-policy.ts";

const CLEAR: IntentVerdict = { intent: "product_search", intentConfidence: 0.95, emergency: 0, injection: 0 };

describe("decideGate precedence", () => {
  it("blocks an emergency before an injection or an intent", () => {
    const decision = decideGate({ intent: "greeting", intentConfidence: 0.99, emergency: 0.99, injection: 0.99 });

    expect(decision).toEqual({ action: "block", reason: "emergency", reply: GATE_REPLIES.emergency });
  });

  it("blocks an injection before an off-topic intent", () => {
    const decision = decideGate({ intent: "out_of_scope", intentConfidence: 0.99, emergency: 0, injection: 0.99 });

    expect(decision).toEqual({ action: "block", reason: "injection", reply: GATE_REPLIES.injection });
  });
});

describe("decideGate thresholds", () => {
  it("blocks an emergency at its threshold and lets a lower score through", () => {
    expect(decideGate({ ...CLEAR, emergency: EMERGENCY_THRESHOLD })).toMatchObject({
      action: "block",
      reason: "emergency",
    });
    expect(decideGate({ ...CLEAR, emergency: EMERGENCY_THRESHOLD - 0.01 })).toEqual({ action: "allow" });
  });

  it("blocks an injection at its threshold and lets a lower score through", () => {
    expect(decideGate({ ...CLEAR, injection: INJECTION_THRESHOLD })).toMatchObject({
      action: "block",
      reason: "injection",
    });
    expect(decideGate({ ...CLEAR, injection: INJECTION_THRESHOLD - 0.01 })).toEqual({ action: "allow" });
  });

  it("blocks a greeting at the intent confidence threshold and lets a lower confidence through", () => {
    expect(decideGate({ ...CLEAR, intent: "greeting", intentConfidence: INTENT_CONFIDENCE_THRESHOLD })).toEqual({
      action: "block",
      reason: "greeting",
      reply: GATE_REPLIES.greeting,
    });
    expect(decideGate({ ...CLEAR, intent: "greeting", intentConfidence: INTENT_CONFIDENCE_THRESHOLD - 0.01 })).toEqual({
      action: "allow",
    });
  });

  it("blocks an off-topic question at the intent confidence threshold and lets a lower confidence through", () => {
    expect(decideGate({ ...CLEAR, intent: "out_of_scope", intentConfidence: INTENT_CONFIDENCE_THRESHOLD })).toEqual({
      action: "block",
      reason: "out_of_scope",
      reply: GATE_REPLIES.out_of_scope,
    });
    expect(decideGate({ ...CLEAR, intent: "out_of_scope", intentConfidence: 0.2 })).toEqual({ action: "allow" });
  });
});

describe("decideGate unclear verdicts", () => {
  it("lets a greeting through when Jev reports no confidence", () => {
    expect(decideGate({ ...CLEAR, intent: "greeting", intentConfidence: null })).toEqual({ action: "allow" });
  });

  it("lets an off-topic question through when Jev reports no confidence", () => {
    expect(decideGate({ ...CLEAR, intent: "out_of_scope", intentConfidence: null })).toEqual({ action: "allow" });
  });
});

describe("decideGate product intents", () => {
  it.each(["product_search", "product_detail", "order_help"] as const)(
    "always lets %s through, even with full confidence",
    (intent) => {
      expect(decideGate({ intent, intentConfidence: 1, emergency: 0, injection: 0 })).toEqual({ action: "allow" });
    },
  );
});
