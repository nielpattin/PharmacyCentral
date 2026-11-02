import { z } from "zod";

import { aiProviders, type AiProviderId } from "./credentials.ts";

/** Amounts are USD with at most six decimals, which is the precision of the stored micro-USD. */
const usdAmount = (max: number) =>
  z
    .number()
    .nonnegative()
    .max(max)
    .refine(
      (value) => Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 1e-6,
      "at most six decimal places",
    );

/** A price per one million tokens for one provider model. Image cost is optional. */
export const priceRequestSchema = z.object({
  provider: z.enum(aiProviders),
  model: z.string().trim().min(1).max(128),
  inputUsdPerMillion: usdAmount(100_000),
  outputUsdPerMillion: usdAmount(100_000),
  imageUsdPerImage: usdAmount(1_000).nullable(),
});
export type PriceRequest = z.infer<typeof priceRequestSchema>;

/** Null means no limit for that window. */
export const budgetRequestSchema = z.object({
  dailyLimitUsd: usdAmount(1_000_000).nullable(),
  monthlyLimitUsd: usdAmount(10_000_000).nullable(),
});
export type BudgetRequest = z.infer<typeof budgetRequestSchema>;

export type AiBudgetPurpose = "chatbot" | "intent-gate";

export type ModelPriceView = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  imageUsdPerImage: number | null;
  updatedAt: string;
  updatedBy: string;
};

export type ConfiguredModelView = {
  purpose: AiBudgetPurpose;
  label: string;
  provider: AiProviderId;
  model: string;
  /** Null until a Platform Admin enters the price. The table is never filled with guessed prices. */
  price: ModelPriceView | null;
};

export type AiBudgetView = {
  timezone: "Asia/Ho_Chi_Minh";
  limits: { dailyUsd: number | null; monthlyUsd: number | null };
  spend: { todayUsd: number; monthUsd: number; todayStart: string; monthStart: string };
  models: ConfiguredModelView[];
};
