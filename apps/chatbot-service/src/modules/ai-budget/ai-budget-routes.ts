import type { AccessTokenVerifier } from "@pharmacy/auth";
import { Router } from "express";

import {
  budgetRequestSchema,
  priceRequestSchema,
  type AiBudgetPurpose,
  type AiBudgetView,
  type ConfiguredModelView,
} from "../../contracts/ai-budget.ts";
import type { AiProviderId } from "../../contracts/credentials.ts";
import { platformAdminId } from "../credentials/credential-routes.ts";
import type { AiBudgetStore } from "./ai-budget-store.ts";
import { microToUsd, spendWindows, usdToMicro } from "./ai-pricing.ts";

export const AI_BUDGET_PATH = "/chatbot/ai-budget";
export const AI_PRICE_PATH = "/chatbot/ai-prices";

const FEATURE_LABELS: Record<AiBudgetPurpose, string> = {
  chatbot: "Shopping assistant",
  "intent-gate": "Question screening",
};

const BAD_REQUEST = {
  type: "https://api.pharmacycentral.local/problems/invalid-request",
  title: "Invalid request",
  status: 400,
  code: "invalid_request",
};

export type ConfiguredModelRef = { purpose: AiBudgetPurpose; provider: AiProviderId; model: string };

export type AiBudgetRouteOptions = {
  store: AiBudgetStore;
  clock: () => Date;
  verifier: AccessTokenVerifier;
  /** The models the features are configured to call right now, so the price table lists exactly those. */
  configuredModels: () => Promise<ConfiguredModelRef[]>;
};

export const buildAiBudgetView = async (options: AiBudgetRouteOptions): Promise<AiBudgetView> => {
  const now = options.clock();
  const windows = spendWindows(now);
  const [limits, todaySpend, monthSpend, configured] = await Promise.all([
    options.store.findLimits(),
    options.store.spendSince(windows.dayStart),
    options.store.spendSince(windows.monthStart),
    options.configuredModels(),
  ]);
  const models: ConfiguredModelView[] = await Promise.all(
    configured.map(async (ref) => {
      const price = await options.store.findPrice(ref.provider, ref.model);
      return {
        purpose: ref.purpose,
        label: FEATURE_LABELS[ref.purpose],
        provider: ref.provider,
        model: ref.model,
        price: price
          ? {
              inputUsdPerMillion: microToUsd(price.inputMicroUsdPerMillion),
              outputUsdPerMillion: microToUsd(price.outputMicroUsdPerMillion),
              imageUsdPerImage: price.imageMicroUsdPerImage === null ? null : microToUsd(price.imageMicroUsdPerImage),
              updatedAt: price.updatedAt.toISOString(),
              updatedBy: price.updatedBy,
            }
          : null,
      };
    }),
  );
  return {
    timezone: "Asia/Ho_Chi_Minh",
    limits: {
      dailyUsd: limits.dailyMicroUsd === null ? null : microToUsd(limits.dailyMicroUsd),
      monthlyUsd: limits.monthlyMicroUsd === null ? null : microToUsd(limits.monthlyMicroUsd),
    },
    spend: {
      todayUsd: microToUsd(todaySpend),
      monthUsd: microToUsd(monthSpend),
      todayStart: windows.dayStart.toISOString(),
      monthStart: windows.monthStart.toISOString(),
    },
    models,
  };
};

/** Platform Admin only. The same check guards the credential routes. */
export const createAiBudgetRouter = (options: AiBudgetRouteOptions): Router => {
  const router = Router();

  router.get(AI_BUDGET_PATH, async (request, response) => {
    if (!(await platformAdminId(request, response, options))) return;
    response.json(await buildAiBudgetView(options));
  });

  router.put(AI_BUDGET_PATH, async (request, response) => {
    const actorId = await platformAdminId(request, response, options);
    if (!actorId) return;
    const body = budgetRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json(BAD_REQUEST);
      return;
    }
    await options.store.saveLimits(
      {
        dailyMicroUsd: body.data.dailyLimitUsd === null ? null : usdToMicro(body.data.dailyLimitUsd),
        monthlyMicroUsd: body.data.monthlyLimitUsd === null ? null : usdToMicro(body.data.monthlyLimitUsd),
      },
      actorId,
      options.clock(),
    );
    response.json(await buildAiBudgetView(options));
  });

  router.put(AI_PRICE_PATH, async (request, response) => {
    const actorId = await platformAdminId(request, response, options);
    if (!actorId) return;
    const body = priceRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json(BAD_REQUEST);
      return;
    }
    await options.store.savePrice(
      {
        provider: body.data.provider,
        model: body.data.model,
        inputMicroUsdPerMillion: usdToMicro(body.data.inputUsdPerMillion),
        outputMicroUsdPerMillion: usdToMicro(body.data.outputUsdPerMillion),
        imageMicroUsdPerImage: body.data.imageUsdPerImage === null ? null : usdToMicro(body.data.imageUsdPerImage),
      },
      actorId,
      options.clock(),
    );
    response.json(await buildAiBudgetView(options));
  });

  return router;
};
