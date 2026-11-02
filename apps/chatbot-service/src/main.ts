import "./telemetry.ts"; // Must load first so the instrumentations can patch libraries.
import { createServer } from "node:http";

import { createAccessTokenVerifier } from "@pharmacy/auth";
import { z } from "zod";

import { createApp } from "./app.ts";
import { chatModelProviders, intentGateProviders, type CredentialStatus } from "./contracts/credentials.ts";
import type { ChatModel } from "./domain/chat-model.ts";
import { DrizzleChatSessionStore } from "./infrastructure/drizzle-chat-session-store.ts";
import { DrizzleCredentialStore } from "./infrastructure/drizzle-credential-store.ts";
import { CatalogProductLookup } from "./infrastructure/catalog-product-lookup.ts";
import { GeminiChatModel } from "./infrastructure/gemini-chat-model.ts";
import { OpenAiCompatibleChatModel } from "./infrastructure/openai-compatible-chat-model.ts";
import { ConfiguredChatModel } from "./infrastructure/configured-chat-model.ts";
import { ConfiguredIntentGate } from "./infrastructure/configured-intent-gate.ts";
import { JevIntentClassifier } from "./infrastructure/jev-intent-classifier.ts";
import { DrizzleAiBudgetStore } from "./infrastructure/drizzle-ai-budget-store.ts";
import { readAiProviderSettings, type AiProviderSettings } from "./infrastructure/ai-provider-config.ts";
import { SecretBox } from "./infrastructure/secret-box.ts";
import { createAdapterSource, type AiAdapters } from "./modules/credentials/ai-adapters.ts";
import { AiCredentialVault } from "./modules/credentials/ai-credential-vault.ts";
import { CHATBOT_CREDENTIAL_PATH, INTENT_GATE_CREDENTIAL_PATH } from "./modules/credentials/credential-routes.ts";
import { AiBudgetGuard } from "./modules/ai-budget/ai-budget-guard.ts";
import { BudgetedChatModel, BudgetedIntentClassifier } from "./modules/ai-budget/budgeted-ai.ts";
import {
  AI_MAX_CONCURRENT_CALLS,
  AI_QUEUE_TIMEOUT_MS,
  ConcurrencyLimiter,
} from "./modules/ai-budget/concurrency-limiter.ts";
import type { AiBudgetPurpose } from "./contracts/ai-budget.ts";
import type { ConfiguredModelRef } from "./modules/ai-budget/ai-budget-routes.ts";
import { createLogger } from "./logger.ts";
import { createChatDatabase } from "./shared/infrastructure/database.ts";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  }
  return value;
};

const portSchema = z.coerce.number().int().min(1).max(65535);
const parsedPort = portSchema.safeParse(requireEnv("PORT"));
if (!parsedPort.success) {
  throw new Error("Invalid environment variable: PORT must be an integer from 1 to 65535.");
}
const port = parsedPort.data;
const logger = createLogger();
const verifier = createAccessTokenVerifier({ jwks: requireEnv("IDENTITY_JWKS_URL") });
const database = createChatDatabase(requireEnv("DATABASE_URL"));
const credentialStore = new DrizzleCredentialStore(database);
const sealer = new SecretBox(requireEnv("SECRETS_ENCRYPTION_KEY"));
const vault = new AiCredentialVault({
  store: credentialStore,
  sealer,
  purpose: "chatbot",
  fallback: readAiProviderSettings("chatbot", process.env),
  cacheMs: 60_000,
});
const gateVault = new AiCredentialVault({
  store: credentialStore,
  sealer,
  purpose: "intent-gate",
  fallback: readAiProviderSettings("intent-gate", process.env),
  cacheMs: 60_000,
});

// One guard for every provider call of this service: the daily and monthly limits and the concurrency cap are shared.
const budgetStore = new DrizzleAiBudgetStore(database);
const budget = new AiBudgetGuard({
  store: budgetStore,
  limiter: new ConcurrencyLimiter(AI_MAX_CONCURRENT_CALLS, AI_QUEUE_TIMEOUT_MS),
  clock: () => new Date(),
});
// Each adapter is built from one settings snapshot, so the price lookup and the call use the same provider and model.
const budgetedChat = (purpose: AiBudgetPurpose, settings: AiProviderSettings, inner: ChatModel): ChatModel =>
  new BudgetedChatModel(inner, { purpose, provider: settings.provider, model: settings.model }, budget);

// Typed against the chat providers, so a provider added to the contract without an adapter fails to compile.
type ChatModelProvider = (typeof chatModelProviders)[number];
const chatModelAdapters: AiAdapters<ChatModel, ChatModelProvider> = {
  gemini: (settings) => budgetedChat("chatbot", settings, new GeminiChatModel(settings)),
  "openai-compatible": (settings) => budgetedChat("chatbot", settings, new OpenAiCompatibleChatModel(settings)),
};

const configuredModel = (purpose: AiBudgetPurpose, status: CredentialStatus): ConfiguredModelRef[] =>
  status.configured ? [{ purpose, provider: status.provider, model: status.model }] : [];

const app = createApp({
  verifier,
  deps: {
    model: new ConfiguredChatModel(createAdapterSource(() => vault.current(), chatModelAdapters)),
    gate: new ConfiguredIntentGate(
      createAdapterSource(() => gateVault.current(), {
        typesafe: (settings) =>
          new BudgetedIntentClassifier(
            new JevIntentClassifier(settings),
            { purpose: "intent-gate", provider: settings.provider, model: settings.model },
            budget,
          ),
      }),
    ),
    reportGate: ({ decision, reason, verdict }) => {
      logger.info(
        {
          decision,
          reason,
          intent: verdict.intent,
          intentConfidence: verdict.intentConfidence,
          emergency: verdict.emergency,
          injection: verdict.injection,
        },
        "intent gate decision",
      );
    },
    products: new CatalogProductLookup(requireEnv("CATALOG_SERVICE_URL")),
    store: new DrizzleChatSessionStore(database),
    reportUsage: ({ usage, modelCalls }) => {
      logger.info({ ...usage, modelCalls }, "chat turn usage");
    },
  },
  aiBudget: {
    store: budgetStore,
    clock: () => new Date(),
    configuredModels: async () => [
      ...configuredModel("chatbot", await vault.status()),
      ...configuredModel("intent-gate", await gateVault.status()),
    ],
  },
  credentials: [
    {
      path: CHATBOT_CREDENTIAL_PATH,
      providers: chatModelProviders,
      vault,
    },
    {
      path: INTENT_GATE_CREDENTIAL_PATH,
      providers: intentGateProviders,
      vault: gateVault,
    },
  ],
  logger,
});
const server = createServer(app);

const shutdown = (signal: string): void => {
  server.close((error) => {
    if (error) {
      logger.error({ error, signal }, "service shutdown failed");
      process.exitCode = 1;
    }
    void database.pool.end();
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "service listening");
});
