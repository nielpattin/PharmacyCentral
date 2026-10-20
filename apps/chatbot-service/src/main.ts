import { createServer } from "node:http";

import { z } from "zod";

import { createApp } from "./app.ts";
import { chatModelProviders, intentGateProviders } from "./contracts/credentials.ts";
import type { ChatModel } from "./domain/chat-model.ts";
import { DrizzleChatSessionStore } from "./infrastructure/drizzle-chat-session-store.ts";
import { DrizzleCredentialStore } from "./infrastructure/drizzle-credential-store.ts";
import { CatalogProductLookup } from "./infrastructure/catalog-product-lookup.ts";
import { GeminiChatModel } from "./infrastructure/gemini-chat-model.ts";
import { OpenAiCompatibleChatModel } from "./infrastructure/openai-compatible-chat-model.ts";
import { ConfiguredChatModel } from "./infrastructure/configured-chat-model.ts";
import { ConfiguredIntentGate } from "./infrastructure/configured-intent-gate.ts";
import { JevIntentClassifier } from "./infrastructure/jev-intent-classifier.ts";
import { readAiProviderSettings } from "./infrastructure/ai-provider-config.ts";
import { SecretBox } from "./infrastructure/secret-box.ts";
import { createAdapterSource, type AiAdapters } from "./modules/credentials/ai-adapters.ts";
import { AiCredentialVault } from "./modules/credentials/ai-credential-vault.ts";
import { CHATBOT_CREDENTIAL_PATH, INTENT_GATE_CREDENTIAL_PATH } from "./modules/credentials/credential-routes.ts";
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
const identitySecret = requireEnv("INTERNAL_IDENTITY_SECRET");
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

// Typed against the chat providers, so a provider added to the contract without an adapter fails to compile.
type ChatModelProvider = (typeof chatModelProviders)[number];
const chatModelAdapters: AiAdapters<ChatModel, ChatModelProvider> = {
  gemini: (settings) => new GeminiChatModel(settings),
  "openai-compatible": (settings) => new OpenAiCompatibleChatModel(settings),
};

const app = createApp({
  deps: {
    model: new ConfiguredChatModel(createAdapterSource(() => vault.current(), chatModelAdapters)),
    gate: new ConfiguredIntentGate(
      createAdapterSource(() => gateVault.current(), { typesafe: (settings) => new JevIntentClassifier(settings) }),
    ),
    reportGate: ({ decision, reason, verdict }) => {
      logger.info(
        {
          decision,
          reason,
          intent: verdict?.intent ?? null,
          intentConfidence: verdict?.intentConfidence ?? null,
          emergency: verdict?.emergency ?? null,
          injection: verdict?.injection ?? null,
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
  credentials: [
    {
      path: CHATBOT_CREDENTIAL_PATH,
      providers: chatModelProviders,
      vault,
      identitySecret,
      audience: "chatbot-service",
    },
    {
      path: INTENT_GATE_CREDENTIAL_PATH,
      providers: intentGateProviders,
      vault: gateVault,
      identitySecret,
      audience: "chatbot-service",
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
