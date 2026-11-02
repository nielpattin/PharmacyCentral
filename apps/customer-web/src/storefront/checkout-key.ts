import { newUuid } from "./ids.ts";

/**
 * The Idempotency-Key of checkout submissions. A submission is identified by its signature (the order request and the
 * lines it orders). Resubmitting the same signature, after a failed or unanswered request, reuses the key, so the
 * server answers the order it already created instead of placing a second one. A changed signature, or a submission
 * that created its order (`settle`), gets a new key.
 */
export type CheckoutKeys = {
  keyFor(signature: string): string;
  settle(): void;
};

export const createCheckoutKeys = (generate: () => string = newUuid): CheckoutKeys => {
  let current: { signature: string; key: string } | undefined;
  return {
    keyFor(signature) {
      if (!current || current.signature !== signature) current = { signature, key: generate() };
      return current.key;
    },
    settle() {
      current = undefined;
    },
  };
};
