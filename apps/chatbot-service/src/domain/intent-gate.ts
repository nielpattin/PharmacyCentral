/** What the customer is asking about. The blocked intents are listed last, because Jev leans toward the first option. */
export const GATE_INTENTS = ["product_search", "product_detail", "order_help", "greeting", "out_of_scope"] as const;
export type GateIntent = (typeof GATE_INTENTS)[number];

export type IntentGateInput = {
  question: string;
  previousQuestion: string | undefined;
  previousReply: string | undefined;
};

/** The raw answers of the classifier. The decision to block is made by the chat use case, never by an adapter. */
export type IntentVerdict = {
  intent: GateIntent;
  /** The confidence Jev reports for the chosen intent, or null when it reports none. */
  intentConfidence: number | null;
  /** The probability, from 0 to 1, that the customer describes a medical emergency or a risk of self harm. */
  emergency: number;
  /** The probability, from 0 to 1, that the message tries to override the assistant's rules. */
  injection: number;
};

/** A classifier call that did not produce a verdict: network, timeout, rate limit, overload, rejected key, bad shape. */
export class IntentGateError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntentGateError";
  }
}

/** One provider adapter. It retries transient failures itself and throws IntentGateError when it gives up. */
export interface IntentClassifier {
  classify(input: IntentGateInput): Promise<IntentVerdict>;
}

/**
 * The port of the chat use case. It always answers a verdict or throws IntentGateError: with no screening key configured
 * the question is refused, never sent to the model unscreened.
 */
export interface IntentGate {
  check(input: IntentGateInput): Promise<IntentVerdict>;
}
