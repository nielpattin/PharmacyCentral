import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { UsageRecord } from "../modules/ai-budget/ai-budget-store.ts";
import type { ChatDatabase } from "../shared/infrastructure/database.ts";
import * as schema from "../shared/infrastructure/schema.ts";
import { DrizzleAiBudgetStore } from "./drizzle-ai-budget-store.ts";

const ADMIN = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-11-15T10:00:00.000Z");

const usage = (createdAt: Date, costMicroUsd: number | null): UsageRecord => ({
  createdAt,
  purpose: "chatbot",
  provider: "gemini",
  model: "example-model-1",
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 50,
  thoughtTokens: 0,
  modelCalls: 1,
  usageSource: "provider",
  costMicroUsd,
});

describe("DrizzleAiBudgetStore", () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  const store = new DrizzleAiBudgetStore({ db, pool: undefined } as unknown as ChatDatabase);

  beforeAll(async () => {
    const migration = new URL("../../drizzle/migrations/0002_ai_budget.sql", import.meta.url);
    await client.exec(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await client.exec("DELETE FROM ai_usage_ledger; DELETE FROM ai_model_prices; DELETE FROM ai_budget_settings;");
  });

  afterAll(async () => {
    await client.close();
  });

  it("finds no price before one is saved", async () => {
    expect(await store.findPrice("gemini", "example-model-1")).toBeUndefined();
  });

  it("saves a price and returns it in micro-USD", async () => {
    await store.savePrice(
      {
        provider: "gemini",
        model: "example-model-1",
        inputMicroUsdPerMillion: 1_250_000,
        outputMicroUsdPerMillion: 10_000_000,
        imageMicroUsdPerImage: null,
      },
      ADMIN,
      NOW,
    );

    expect(await store.findPrice("gemini", "example-model-1")).toEqual({
      provider: "gemini",
      model: "example-model-1",
      inputMicroUsdPerMillion: 1_250_000,
      outputMicroUsdPerMillion: 10_000_000,
      imageMicroUsdPerImage: null,
      updatedAt: NOW,
      updatedBy: ADMIN,
    });
  });

  it("replaces the price of the same model rather than adding a row", async () => {
    const base = {
      provider: "gemini",
      model: "example-model-1",
      inputMicroUsdPerMillion: 1_000_000,
      outputMicroUsdPerMillion: 2_000_000,
      imageMicroUsdPerImage: 500,
    };
    await store.savePrice(base, ADMIN, NOW);
    await store.savePrice({ ...base, outputMicroUsdPerMillion: 3_000_000, imageMicroUsdPerImage: null }, ADMIN, NOW);

    const row = await store.findPrice("gemini", "example-model-1");
    expect(row).toMatchObject({ outputMicroUsdPerMillion: 3_000_000, imageMicroUsdPerImage: null });
    const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_model_prices");
    expect(count.rows[0]?.n).toBe(1);
  });

  it("reads no limits before any are saved", async () => {
    expect(await store.findLimits()).toEqual({ dailyMicroUsd: null, monthlyMicroUsd: null });
  });

  it("saves the limits as one row and clears one of them with null", async () => {
    await store.saveLimits({ dailyMicroUsd: 5_000_000, monthlyMicroUsd: 100_000_000 }, ADMIN, NOW);
    await store.saveLimits({ dailyMicroUsd: null, monthlyMicroUsd: 90_000_000 }, ADMIN, NOW);

    expect(await store.findLimits()).toEqual({ dailyMicroUsd: null, monthlyMicroUsd: 90_000_000 });
    const count = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM ai_budget_settings");
    expect(count.rows[0]?.n).toBe(1);
  });

  it("sums the cost recorded since the given time and ignores rows without a cost", async () => {
    await store.recordUsage(usage(new Date("2026-11-15T09:00:00.000Z"), 1_200));
    await store.recordUsage(usage(new Date("2026-11-15T09:30:00.000Z"), 800));
    await store.recordUsage(usage(new Date("2026-11-15T09:45:00.000Z"), null));
    await store.recordUsage(usage(new Date("2026-11-01T09:00:00.000Z"), 5_000));

    expect(await store.spendSince(new Date("2026-11-15T00:00:00.000Z"))).toBe(2_000);
    expect(await store.spendSince(new Date("2026-11-20T00:00:00.000Z"))).toBe(0);
  });

  it("stores the usage source and the token counts of each call", async () => {
    await store.recordUsage({ ...usage(NOW, null), usageSource: "estimated", thoughtTokens: 7, modelCalls: 2 });

    const row = await client.query<{ usage_source: string; thought_tokens: number; model_calls: number }>(
      "SELECT usage_source, thought_tokens, model_calls FROM ai_usage_ledger",
    );
    expect(row.rows[0]).toEqual({ usage_source: "estimated", thought_tokens: 7, model_calls: 2 });
  });
});
