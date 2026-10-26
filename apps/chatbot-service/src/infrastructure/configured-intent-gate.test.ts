import { describe, expect, it, vi } from "vitest";

import type { IntentClassifier, IntentGateInput, IntentVerdict } from "../domain/intent-gate.ts";
import { IntentGateError } from "../domain/intent-gate.ts";
import { ConfiguredIntentGate } from "./configured-intent-gate.ts";

const INPUT: IntentGateInput = {
  question: "Thuốc ho này giá bao nhiêu?",
  previousQuestion: undefined,
  previousReply: undefined,
};
const VERDICT: IntentVerdict = { intent: "product_detail", intentConfidence: 0.9, emergency: 0, injection: 0 };

describe("ConfiguredIntentGate", () => {
  it("refuses with IntentGateError when no screening key is configured, so the question never reaches the model", async () => {
    const gate = new ConfiguredIntentGate(async () => undefined);

    await expect(gate.check(INPUT)).rejects.toBeInstanceOf(IntentGateError);
  });

  it("returns the verdict of the classifier built from the current settings", async () => {
    const classify = vi.fn<IntentClassifier["classify"]>(async () => VERDICT);
    const gate = new ConfiguredIntentGate(async () => ({ classify }));

    await expect(gate.check(INPUT)).resolves.toEqual(VERDICT);
    expect(classify).toHaveBeenCalledWith(INPUT);
  });

  it("reports a failing settings read as an IntentGateError with the cause attached", async () => {
    const cause = new Error("database down");
    const gate = new ConfiguredIntentGate(async () => {
      throw cause;
    });

    const failure = await gate.check(INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IntentGateError);
    expect(failure).toHaveProperty("message", "The AI provider settings could not be read");
    expect(failure).toHaveProperty("cause", cause);
  });

  it("lets a classifier failure reach the caller unchanged", async () => {
    const failure = new IntentGateError("Jev answered HTTP 422");
    const gate = new ConfiguredIntentGate(async () => ({
      classify: async () => {
        throw failure;
      },
    }));

    await expect(gate.check(INPUT)).rejects.toBe(failure);
  });
});
