// Must load first so the OpenTelemetry instrumentations can patch libraries before they are imported.
import "./telemetry.ts";
import express from "express";
import { createServer } from "node:http";
import { z } from "zod";

import { createAccessTokenVerifier } from "@pharmacy/auth";
import { ReadThroughCache, RedisCacheStore, createRedisCacheClient } from "@pharmacy/cache";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "./middleware/trusted-request.ts";
import { BusinessRuleError } from "./shared/business-rule-error.ts";

import { AvailabilityProjection } from "./modules/availability/application/availability-projection.ts";
import { RabbitMqAvailabilityConsumer } from "./modules/availability/infrastructure/rabbitmq-availability-consumer.ts";
import { createAuditMiddleware } from "./modules/audit/audit-middleware.ts";
import { createAuditRecorder } from "./modules/audit/audit-recorder.ts";
import { CATALOG_AUDIT_RULES } from "./modules/audit/audit-rules.ts";
import { CatalogOutboxPublisher } from "./modules/outbox-publisher.ts";
import { createCatalogImportRouter } from "./modules/catalog-import-routes.ts";
import { CatalogImportService } from "./modules/catalog-import-service.ts";
import { createCatalogRouter } from "./modules/catalog-routes.ts";
import { ProductMediaStore } from "./modules/catalog/product-media-store.ts";
import { GeminiTextEmbedder } from "./modules/catalog/search/gemini-text-embedder.ts";
import { withQueryEmbeddingCache } from "./modules/catalog/search/query-embedding-cache.ts";
import { OpenAiCompatibleTextEmbedder } from "./modules/catalog/search/openai-compatible-text-embedder.ts";
import { ProductSearchIndexer } from "./modules/catalog/search/product-search-indexer.ts";
import { DrizzleSearchSynonymStore } from "./modules/catalog/search/synonyms/infrastructure/drizzle-search-synonym-store.ts";
import { SearchSynonymService } from "./modules/catalog/search/synonyms/search-synonym-service.ts";
import { createSearchSynonymRouter } from "./modules/catalog/search/synonyms/search-synonym-routes.ts";
import { TypesenseProductSearchIndex } from "./modules/catalog/search/typesense-product-search-index.ts";
import type { TextEmbedder, TextEmbedderSource } from "./modules/catalog/search/text-embedder.ts";
import { DrizzleCredentialStore } from "./infrastructure/drizzle-credential-store.ts";
import { readAiProviderSettings } from "./infrastructure/ai-provider-config.ts";
import { SecretBox } from "./infrastructure/secret-box.ts";
import { createAdapterSource } from "./modules/credentials/ai-adapters.ts";
import { AiCredentialVault } from "./modules/credentials/ai-credential-vault.ts";
import { createCredentialRouter } from "./modules/credentials/credential-routes.ts";
import { CATALOG_CACHE_NAMESPACE } from "./modules/catalog/read-cache.ts";
import { DrizzleStoreRepository } from "./modules/stores/infrastructure/drizzle-store-repository.ts";
import { createCatalogDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "catalog-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const portResult = z.coerce.number().int().min(1).max(65535).safeParse(portStr);
if (!portResult.success) throw new Error("PORT must be an integer from 1 to 65535.");
const port = portResult.data;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Please set it in your .env file.`);
  return value;
};

const rabbitmqUrl = requireEnv("RABBITMQ_URL");
const redis = createRedisCacheClient(requireEnv("REDIS_URL"), {
  onError: (error: unknown) => logger.warn({ error }, "Redis client error"),
});
// Shared by every replica: a write on one replica drops the entries the others would read.
const readCache = new ReadThroughCache(new RedisCacheStore(redis), {
  namespace: CATALOG_CACHE_NAMESPACE,
  warn: (error, operation) => logger.warn({ error, operation }, "catalog read cache degraded"),
});
const database = createCatalogDatabase();
const outboxPublisher = database ? new CatalogOutboxPublisher(database, logger, rabbitmqUrl) : undefined;
outboxPublisher?.start();
const storeRepository = database ? new DrizzleStoreRepository(database) : undefined;
const catalogImportService = database ? new CatalogImportService(database) : undefined;
const mediaStore = ProductMediaStore.createFromEnvironment();
const synonymStore = database ? new DrizzleSearchSynonymStore(database) : undefined;
const loadApprovedSynonyms = async () => {
  if (!synonymService) throw new Error("Catalog database is not configured");
  return synonymService.approvedSynonymItems();
};
const searchIndex = new TypesenseProductSearchIndex({
  baseUrl: requireEnv("TYPESENSE_URL"),
  apiKey: requireEnv("TYPESENSE_API_KEY"),
  loadSynonyms: loadApprovedSynonyms,
});
const synonymService = synonymStore
  ? new SearchSynonymService({
      store: synonymStore,
      syncSynonyms: (items) => searchIndex.syncSynonyms(items),
      logger,
    })
  : undefined;
const fallback = readAiProviderSettings("embedding", process.env);
const vault = database
  ? new AiCredentialVault({
      store: new DrizzleCredentialStore(database),
      sealer: new SecretBox(requireEnv("SECRETS_ENCRYPTION_KEY")),
      purpose: "embedding",
      fallback,
      cacheMs: 60_000,
    })
  : undefined;
const embedders: TextEmbedderSource = createAdapterSource<TextEmbedder>(
  async () => (vault ? vault.current() : undefined),
  {
    gemini: (settings) => new GeminiTextEmbedder(settings),
    "openai-compatible": (settings) => new OpenAiCompatibleTextEmbedder(settings),
  },
);
const searchIndexer = database
  ? new ProductSearchIndexer({ database, index: searchIndex, embedders, logger })
  : undefined;
void searchIndexer?.requestSweep();
const availabilityConsumer = database
  ? new RabbitMqAvailabilityConsumer(
      new AvailabilityProjection(database, { onApplied: () => readCache.invalidate("availability") }),
      logger,
      rabbitmqUrl,
    )
  : undefined;
availabilityConsumer?.start();

app.disable("x-powered-by");
app.use("/products", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }));
app.use("/products/imports", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
// Browser routes authenticate with the access token identity-service issues (verified against its JWKS);
// handlers enforce the remaining session and role rules. Only these reads answer without a session:
// the published price list is public and its handler narrows a non-staff caller to Published rows.
const identity = { verifier: createAccessTokenVerifier({ jwks: requireEnv("IDENTITY_JWKS_URL") }) };
const publicCatalogPaths: readonly string[] = [
  "/products",
  "/pricing/active",
  "/pricing/prices",
  "/stores",
  "/availability",
];
app.use(
  createTrustedRequestMiddleware({
    verifier: identity.verifier,
    isPublic: (request) =>
      ["GET", "HEAD"].includes(request.method) &&
      publicCatalogPaths.some((prefix) => matchesPathPrefix(request.path, prefix)),
  }),
);
if (database) app.use(createAuditMiddleware(CATALOG_AUDIT_RULES, createAuditRecorder(database, logger)));
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) => response.json({ status: "ok", service: serviceName }));
const requestSearchSweep = (): void => void searchIndexer?.requestSweep();
if (vault) {
  app.use(
    createCredentialRouter({
      vault,
      verifier: identity.verifier,
      onSettingsChanged: requestSearchSweep,
    }),
  );
} else {
  app.use("/products/search-credential", (_request, response) =>
    response.status(503).json({ title: "Credential storage is not configured", status: 503 }),
  );
}
const catalogImported = async (): Promise<void> => {
  requestSearchSweep();
  await readCache.invalidate("products");
  await readCache.invalidate("prices");
};
app.use("/", createCatalogImportRouter(catalogImportService, identity, catalogImported));
app.use(
  "/",
  createSearchSynonymRouter({
    service: synonymService,
    ...identity,
  }),
);
app.use(
  "/",
  createCatalogRouter(storeRepository, mediaStore, {
    ...identity,
    search: { index: searchIndex, embedders: withQueryEmbeddingCache(embedders) },
    onProductsChanged: requestSearchSweep,
    cache: readCache,
    warn: (error) => logger.warn({ error }, "product search degraded"),
  }),
);
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof BusinessRuleError) {
    return response.status(409).json({ title: error.message, status: 409, code: "business_rule" });
  }
  logger.error({ error }, "unhandled request error");
  return response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
  void availabilityConsumer?.close();
  void outboxPublisher?.close();
  void database?.pool.end();
  redis.disconnect();
});
const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close((error) => {
    if (error) {
      logger.error({ error }, "shutdown failed");
      process.exitCode = 1;
    }
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
server.listen(port, "0.0.0.0", () => logger.info({ port }, "listening"));
