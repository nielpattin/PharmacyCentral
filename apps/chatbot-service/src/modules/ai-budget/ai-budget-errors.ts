/** The daily or monthly spend limit would be passed by the call. Raised before the provider is called. */
export class AiBudgetExceededError extends Error {
  public constructor(
    public readonly window: "day" | "month",
    message = `The AI ${window === "day" ? "daily" : "monthly"} spend limit is reached`,
  ) {
    super(message);
    this.name = "AiBudgetExceededError";
  }
}

/** A spend limit is set but the configured model has no price, so the call cannot be priced and is refused. */
export class AiPricingMissingError extends Error {
  public constructor(provider: string, model: string) {
    super(`No price is set for ${provider}/${model}, so the spend limit cannot be enforced`);
    this.name = "AiPricingMissingError";
  }
}

/** No concurrency slot became free within the queue timeout. */
export class AiCapacityError extends Error {
  public constructor(message = "All AI call slots are busy") {
    super(message);
    this.name = "AiCapacityError";
  }
}
