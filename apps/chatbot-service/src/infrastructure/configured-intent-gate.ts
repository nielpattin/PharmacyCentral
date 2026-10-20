import type { IntentClassifier, IntentGate, IntentGateInput, IntentVerdict } from "../domain/intent-gate.ts";
import { IntentGateError } from "../domain/intent-gate.ts";

/** Reads the classifier settings on every question, so a settings change applies without a restart. */
export class ConfiguredIntentGate implements IntentGate {
  public constructor(private readonly source: () => Promise<IntentClassifier | undefined>) {}

  public async check(input: IntentGateInput): Promise<IntentVerdict | undefined> {
    let classifier: IntentClassifier | undefined;
    try {
      classifier = await this.source();
    } catch (cause) {
      throw new IntentGateError("The AI provider settings could not be read", { cause });
    }
    if (!classifier) return undefined;
    return classifier.classify(input);
  }
}
