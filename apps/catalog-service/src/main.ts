import express from "express";
import { createServer } from "node:http";
import { z } from "zod";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "./middleware/trusted-request.ts";

import { AvailabilityProjection } from "./modules/availability/application/availability-projection.ts";
import { RabbitMqAvailabilityConsumer } from "./modules/availability/infrastructure/rabbitmq-availability-consumer.ts";
import { createCatalogImportRouter } from "./modules/catalog-import-routes.ts";
import { CatalogImportService } from "./modules/catalog-import-service.ts";
import { createCatalogRouter } from "./modules/catalog-routes.ts";
import { ProductMediaStore } from "./modules/catalog/product-media-store.ts";
import { GeminiTextEmbedder } from "./modules/catalog/search/gemini-text-embedder.ts";
import { ProductSearchIndexer } from "./modules/catalog/search/product-search-indexer.ts";
import { DrizzleSearchSynonymStore } from "./modules/catalog/search/synonyms/infrastructure/drizzle-search-synonym-store.ts";
import { SearchSynonymService } from "./modules/catalog/search/synonyms/search-synonym-service.ts";
import { createSearchSynonymRouter } from "./modules/catalog/search/synonyms/search-synonym-routes.ts";
import { TypesenseProductSearchIndex } from "./modules/catalog/search/typesense-product-search-index.ts";
import type { TextEmbedderSource } from "./modules/catalog/search/text-embedder.ts";
import { DrizzleCredentialStore } from "./infrastructure/drizzle-credential-store.ts";
import { readAiProviderSettings } from "./infrastructure/ai-provider-config.ts";
import { SecretBox } from "./infrastructure/secret-box.ts";
import { createAdapterSource } from "./modules/credentials/ai-adapters.ts";
import { AiCredentialVault } from "./modules/credentials/ai-credential-vault.ts";
import { createCredentialRouter } from "./modules/credentials/credential-routes.ts";
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

const database = createCatalogDatabase();
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
const embedders: TextEmbedderSource = createAdapterSource(async () => (vault ? vault.current() : undefined), {
  gemini: (settings) => new GeminiTextEmbedder(settings),
});
const searchIndexer = database
  ? new ProductSearchIndexer({ database, index: searchIndex, embedders, logger })
  : undefined;
void searchIndexer?.requestSweep();
const availabilityConsumer = database
  ? new RabbitMqAvailabilityConsumer(new AvailabilityProjection(database))
  : undefined;
if (availabilityConsumer)
  void availabilityConsumer
    .start()
    .catch((error: unknown) => logger.warn({ error }, "availability consumer unavailable"));

app.disable("x-powered-by");
app.use("/products", express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }));
app.use("/products/imports", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
// Browser routes authenticate with the signed identity context minted by identity-service
// (/auth/context); handlers enforce the remaining session and role rules.
const publicCatalogPaths: readonly string[] = [
  "/sites",
  "/storage-locations",
  "/products",
  "/suppliers",
  "/pricing",
  "/stores",
  "/availability",
];
app.use(
  createTrustedRequestMiddleware({
    expectedAudience: serviceName,
    // A single-site employee's location list is narrowed to their site; listing every site's locations is denied.
    siteScopedPaths: ["/storage-locations"],
    isPublic: (request) =>
      ["GET", "HEAD"].includes(request.method) &&
      publicCatalogPaths.some((prefix) => matchesPathPrefix(request.path, prefix)),
  }),
);
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) => response.json({ status: "ok", service: serviceName }));
const requestSearchSweep = (): void => void searchIndexer?.requestSweep();
if (vault) {
  app.use(
    createCredentialRouter({
      vault,
      identitySecret: requireEnv("INTERNAL_IDENTITY_SECRET"),
      audience: serviceName,
      onSettingsChanged: requestSearchSweep,
    }),
  );
} else {
  app.use("/products/search-credential", (_request, response) =>
    response.status(503).json({ title: "Credential storage is not configured", status: 503 }),
  );
}
app.use("/", createCatalogImportRouter(catalogImportService, requestSearchSweep));
app.use(
  "/",
  createSearchSynonymRouter({
    service: synonymService,
    identitySecret: requireEnv("INTERNAL_IDENTITY_SECRET"),
    audience: serviceName,
  }),
);
app.use(
  "/",
  createCatalogRouter(storeRepository, mediaStore, {
    search: { index: searchIndex, embedders },
    onProductsChanged: requestSearchSweep,
    warn: (error) => logger.warn({ error }, "product search degraded"),
  }),
);
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
  void availabilityConsumer?.close();
  void database?.pool.end();
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
