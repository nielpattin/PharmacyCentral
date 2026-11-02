import { createHash } from "node:crypto";

/** Sorts object keys at every depth and drops undefined values, so the same request always serialises the same way. */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
};

/**
 * The SHA-256 hex digest of a parsed order request. A repeat of an Idempotency-Key is the same order only when its
 * fingerprint matches; a different body under the same key is refused.
 */
export const orderRequestFingerprint = (request: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(request)))
    .digest("hex");
