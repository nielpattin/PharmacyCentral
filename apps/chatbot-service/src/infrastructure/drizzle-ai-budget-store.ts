import { and, eq, gte, sql } from "drizzle-orm";

import type { ModelPrice } from "../modules/ai-budget/ai-pricing.ts";
import type { AiBudgetStore, ModelPriceRow, SpendLimits, UsageRecord } from "../modules/ai-budget/ai-budget-store.ts";
import type { ChatDatabase } from "../shared/infrastructure/database.ts";
import { aiBudgetSettings, aiModelPrices, aiUsageLedger } from "../shared/infrastructure/schema.ts";

/** The budget row has id 1 only. The schema checks it. */
const SETTINGS_ID = 1;

export class DrizzleAiBudgetStore implements AiBudgetStore {
  private readonly database: ChatDatabase;

  public constructor(database: ChatDatabase) {
    this.database = database;
  }

  public async findPrice(provider: string, model: string): Promise<ModelPriceRow | undefined> {
    const [row] = await this.database.db
      .select()
      .from(aiModelPrices)
      .where(and(eq(aiModelPrices.provider, provider), eq(aiModelPrices.model, model)))
      .limit(1);
    if (!row) return undefined;
    return {
      provider: row.provider,
      model: row.model,
      inputMicroUsdPerMillion: row.inputMicroUsdPerMillion,
      outputMicroUsdPerMillion: row.outputMicroUsdPerMillion,
      imageMicroUsdPerImage: row.imageMicroUsdPerImage,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  public async savePrice(
    price: ModelPrice & { provider: string; model: string },
    actorId: string,
    now: Date,
  ): Promise<void> {
    const values = {
      provider: price.provider,
      model: price.model,
      inputMicroUsdPerMillion: price.inputMicroUsdPerMillion,
      outputMicroUsdPerMillion: price.outputMicroUsdPerMillion,
      imageMicroUsdPerImage: price.imageMicroUsdPerImage,
      updatedBy: actorId,
      updatedAt: now,
    };
    await this.database.db
      .insert(aiModelPrices)
      .values(values)
      .onConflictDoUpdate({
        target: [aiModelPrices.provider, aiModelPrices.model],
        set: {
          inputMicroUsdPerMillion: values.inputMicroUsdPerMillion,
          outputMicroUsdPerMillion: values.outputMicroUsdPerMillion,
          imageMicroUsdPerImage: values.imageMicroUsdPerImage,
          updatedBy: values.updatedBy,
          updatedAt: values.updatedAt,
        },
      });
  }

  public async findLimits(): Promise<SpendLimits> {
    const [row] = await this.database.db
      .select({
        dailyLimitMicroUsd: aiBudgetSettings.dailyLimitMicroUsd,
        monthlyLimitMicroUsd: aiBudgetSettings.monthlyLimitMicroUsd,
      })
      .from(aiBudgetSettings)
      .where(eq(aiBudgetSettings.id, SETTINGS_ID))
      .limit(1);
    return {
      dailyMicroUsd: row?.dailyLimitMicroUsd ?? null,
      monthlyMicroUsd: row?.monthlyLimitMicroUsd ?? null,
    };
  }

  public async saveLimits(limits: SpendLimits, actorId: string, now: Date): Promise<void> {
    await this.database.db
      .insert(aiBudgetSettings)
      .values({
        id: SETTINGS_ID,
        dailyLimitMicroUsd: limits.dailyMicroUsd,
        monthlyLimitMicroUsd: limits.monthlyMicroUsd,
        updatedBy: actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: aiBudgetSettings.id,
        set: {
          dailyLimitMicroUsd: limits.dailyMicroUsd,
          monthlyLimitMicroUsd: limits.monthlyMicroUsd,
          updatedBy: actorId,
          updatedAt: now,
        },
      });
  }

  public async spendSince(since: Date): Promise<number> {
    const [row] = await this.database.db
      .select({ total: sql<string | null>`sum(${aiUsageLedger.costMicroUsd})` })
      .from(aiUsageLedger)
      .where(gte(aiUsageLedger.createdAt, since));
    // SUM over bigint returns numeric, which the driver sends as a string. Empty sums are null.
    return Number(row?.total ?? 0);
  }

  public async recordUsage(record: UsageRecord): Promise<void> {
    await this.database.db.insert(aiUsageLedger).values({
      createdAt: record.createdAt,
      purpose: record.purpose,
      provider: record.provider,
      model: record.model,
      inputTokens: record.inputTokens,
      cachedInputTokens: record.cachedInputTokens,
      outputTokens: record.outputTokens,
      thoughtTokens: record.thoughtTokens,
      modelCalls: record.modelCalls,
      usageSource: record.usageSource,
      costMicroUsd: record.costMicroUsd,
    });
  }
}
