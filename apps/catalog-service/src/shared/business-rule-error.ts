/**
 * A request that is well formed but not allowed in the record's current state, for example approving an order that is
 * already approved. It answers 409 with the rule as the title, never 500, which is for faults.
 */
export class BusinessRuleError extends Error {
  override readonly name = "BusinessRuleError";
}
