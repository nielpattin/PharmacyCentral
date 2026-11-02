import type { ModelPrice } from "./ai-pricing.ts";

export type ModelPriceRow = ModelPrice & {
  provider: string;
  model: string;
  updatedAt: Date;
  updatedBy: string;
};

export type SpendLimits = { dailyMicroUsd: number | null; monthlyMicroUsd: number | null };

export type UsageRecord = {
  createdAt: Date;
  purpose: string;
  provider: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  modelCalls: number;
  /** `provider` when the provider billed the call, `estimated` when it returned no usage block. */
  usageSource: "provider" | "estimated";
  /** Null only when no price is set and no limit needs one. */
  costMicroUsd: number | null;
};

/** Money and usage persistence for the AI budget. Every amount is integer micro-USD. */
export interface AiBudgetStore {
  findPrice(provider: string, model: string): Promise<ModelPriceRow | undefined>;
  savePrice(price: ModelPrice & { provider: string; model: string }, actorId: string, now: Date): Promise<void>;
  findLimits(): Promise<SpendLimits>;
  saveLimits(limits: SpendLimits, actorId: string, now: Date): Promise<void>;
  /** Sum of recorded cost since `since`. Rows without a cost count as zero. */
  spendSince(since: Date): Promise<number>;
  recordUsage(record: UsageRecord): Promise<void>;
}
