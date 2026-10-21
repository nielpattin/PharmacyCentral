import { metrics } from "@opentelemetry/api";

export type ChatStep = "intent_gate" | "model" | "tool";

const stepDuration = metrics.getMeter("chatbot-service").createHistogram("pharmacy.chatbot.step.duration", {
  unit: "s",
  description: "Time spent in one intent gate classification, model turn or catalog tool run of the chat.",
  advice: { explicitBucketBoundaries: [0.1, 0.5, 1, 2, 5, 10, 30] },
});

/**
 * Times one step and records it once, whatever the outcome. A rejected run is an error, and the rejection still
 * propagates unchanged. `isError` marks a run that resolved with an error result.
 */
export const timeChatStep = async <T>(
  step: ChatStep,
  run: () => Promise<T>,
  isError: (result: T) => boolean = () => false,
): Promise<T> => {
  const started = performance.now();
  let outcome: "ok" | "error" = "ok";
  try {
    const result = await run();
    if (isError(result)) outcome = "error";
    return result;
  } catch (cause) {
    outcome = "error";
    throw cause;
  } finally {
    stepDuration.record((performance.now() - started) / 1000, { step, outcome });
  }
};
