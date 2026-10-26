import type { IntentClassifier, IntentGate, IntentGateInput, IntentVerdict } from "../domain/intent-gate.ts";
import { IntentGateError } from "../domain/intent-gate.ts";
import { timeChatStep } from "./chat-step-metrics.ts";

/**
 * Reads the classifier settings on every question, so a settings change applies without a restart. With no screening
 * key saved the gate fails closed: the question is refused with IntentGateError and never reaches the model.
 */
export class ConfiguredIntentGate implements IntentGate {
  public constructor(private readonly source: () => Promise<IntentClassifier | undefined>) {}

  public async check(input: IntentGateInput): Promise<IntentVerdict> {
    let classifier: IntentClassifier | undefined;
    try {
      classifier = await this.source();
    } catch (cause) {
      throw new IntentGateError("The AI provider settings could not be read", { cause });
    }
    if (!classifier) throw new IntentGateError("No screening key is configured for the intent gate");
    return timeChatStep("intent_gate", () => classifier.classify(input));
  }
}
