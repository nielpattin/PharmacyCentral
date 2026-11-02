import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearerHeaders, testVerifier } from "../../test-support/access-tokens.ts";
import type { AiBudgetStore, ModelPriceRow, SpendLimits, UsageRecord } from "./ai-budget-store.ts";
import { AI_BUDGET_PATH, AI_PRICE_PATH, createAiBudgetRouter, type ConfiguredModelRef } from "./ai-budget-routes.ts";

const ADMIN = "55555555-5555-4555-8555-555555555555";
const MANAGER = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-15T10:00:00.000Z");
const CONFIGURED: ConfiguredModelRef[] = [
  { purpose: "chatbot", provider: "gemini", model: "example-model-1" },
  { purpose: "intent-gate", provider: "typesafe", model: "jev-latest" },
];

const signedHeader = (
  actorType: "customer" | "employee",
  actorId: string,
  roles: string[],
): Promise<Record<string, string>> => bearerHeaders({ actorType, actorId, roles });

const memoryStore = () => {
  const state: { prices: ModelPriceRow[]; limits: SpendLimits; ledger: UsageRecord[] } = {
    prices: [],
    limits: { dailyMicroUsd: null, monthlyMicroUsd: null },
    ledger: [],
  };
  const store: AiBudgetStore = {
    findPrice: async (provider, model) => state.prices.find((row) => row.provider === provider && row.model === model),
    savePrice: async (price, actorId, now) => {
      state.prices = state.prices.filter((row) => !(row.provider === price.provider && row.model === price.model));
      state.prices.push({ ...price, updatedAt: now, updatedBy: actorId });
    },
    findLimits: async () => state.limits,
    saveLimits: async (limits) => {
      state.limits = limits;
    },
    spendSince: async (since) =>
      state.ledger.filter((row) => row.createdAt >= since).reduce((total, row) => total + (row.costMicroUsd ?? 0), 0),
    recordUsage: async (record) => {
      state.ledger.push(record);
    },
  };
  return { store, state };
};

describe("AI budget routes", () => {
  const { store, state } = memoryStore();
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(
    createAiBudgetRouter({
      store,
      clock: () => NOW,
      verifier: testVerifier,
      configuredModels: async () => CONFIGURED,
    }),
  );
  let baseUrl = "";
  let server: Server;

  const send = async (
    method: "GET" | "PUT",
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<Response> =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  let asAdmin: Record<string, string> = {};

  beforeAll(async () => {
    asAdmin = await signedHeader("employee", ADMIN, ["Platform Admin"]);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers 403 to a customer and to an employee who is not Platform Admin", async () => {
    const customer = await signedHeader("customer", CUSTOMER, []);
    const manager = await signedHeader("employee", MANAGER, ["Pharmacy Manager"]);

    expect((await send("GET", AI_BUDGET_PATH, customer)).status).toBe(403);
    expect((await send("GET", AI_BUDGET_PATH, manager)).status).toBe(403);
    expect((await send("PUT", AI_BUDGET_PATH, manager, { dailyLimitUsd: 1, monthlyLimitUsd: 2 })).status).toBe(403);
    expect((await send("PUT", AI_PRICE_PATH, customer, validPrice())).status).toBe(403);
    expect(state.limits).toEqual({ dailyMicroUsd: null, monthlyMicroUsd: null });
  });

  it("shows the configured models with no price until one is entered", async () => {
    const response = await send("GET", AI_BUDGET_PATH, asAdmin);

    expect(response.status).toBe(200);
    const view = (await response.json()) as {
      limits: { dailyUsd: number | null };
      spend: { todayUsd: number; monthUsd: number };
      models: Array<{ purpose: string; price: unknown }>;
    };
    expect(view.limits.dailyUsd).toBeNull();
    expect(view.spend).toMatchObject({ todayUsd: 0, monthUsd: 0 });
    expect(view.models.map((model) => [model.purpose, model.price])).toEqual([
      ["chatbot", null],
      ["intent-gate", null],
    ]);
  });

  it("saves the spend limits in micro-USD and returns the view", async () => {
    const response = await send("PUT", AI_BUDGET_PATH, asAdmin, { dailyLimitUsd: 5, monthlyLimitUsd: 120.25 });

    expect(response.status).toBe(200);
    expect(state.limits).toEqual({ dailyMicroUsd: 5_000_000, monthlyMicroUsd: 120_250_000 });
    expect(await response.json()).toMatchObject({ limits: { dailyUsd: 5, monthlyUsd: 120.25 } });
  });

  it("clears a limit when it is sent as null", async () => {
    await send("PUT", AI_BUDGET_PATH, asAdmin, { dailyLimitUsd: null, monthlyLimitUsd: null });

    expect(state.limits).toEqual({ dailyMicroUsd: null, monthlyMicroUsd: null });
  });

  it("rejects a negative limit, a limit with more than six decimals, and a missing field", async () => {
    expect((await send("PUT", AI_BUDGET_PATH, asAdmin, { dailyLimitUsd: -1, monthlyLimitUsd: null })).status).toBe(400);
    expect(
      (await send("PUT", AI_BUDGET_PATH, asAdmin, { dailyLimitUsd: 0.0000001, monthlyLimitUsd: null })).status,
    ).toBe(400);
    expect((await send("PUT", AI_BUDGET_PATH, asAdmin, { dailyLimitUsd: 1 })).status).toBe(400);
  });

  it("saves a price for a model, then shows it in the table", async () => {
    const response = await send("PUT", AI_PRICE_PATH, asAdmin, validPrice());

    expect(response.status).toBe(200);
    expect(state.prices[0]).toMatchObject({
      provider: "gemini",
      model: "example-model-1",
      inputMicroUsdPerMillion: 1_250_000,
      outputMicroUsdPerMillion: 10_000_000,
      imageMicroUsdPerImage: null,
      updatedBy: ADMIN,
    });
    const view = (await response.json()) as { models: Array<{ price: { inputUsdPerMillion: number } | null }> };
    expect(view.models[0]?.price?.inputUsdPerMillion).toBe(1.25);
  });

  it("rejects a price with an unknown provider or a missing output price", async () => {
    expect((await send("PUT", AI_PRICE_PATH, asAdmin, { ...validPrice(), provider: "unknown" })).status).toBe(400);
    const { outputUsdPerMillion: _omitted, ...withoutOutput } = validPrice();
    expect((await send("PUT", AI_PRICE_PATH, asAdmin, withoutOutput)).status).toBe(400);
  });
});

const validPrice = () => ({
  provider: "gemini",
  model: "example-model-1",
  inputUsdPerMillion: 1.25,
  outputUsdPerMillion: 10,
  imageUsdPerImage: null,
});
