import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, matchesPathPrefix } from "./middleware/trusted-request.ts";

import { AvailabilityProjection } from "./modules/availability/application/availability-projection.ts";
import { RabbitMqAvailabilityConsumer } from "./modules/availability/infrastructure/rabbitmq-availability-consumer.ts";
import { createCatalogImportRouter } from "./modules/catalog-import-routes.ts";
import { CatalogImportService } from "./modules/catalog-import-service.ts";
import { createCatalogRouter } from "./modules/catalog-routes.ts";
import { ProductMediaStore } from "./modules/catalog/product-media-store.ts";
import { DrizzleStoreRepository } from "./modules/stores/infrastructure/drizzle-store-repository.ts";
import { createCatalogDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "catalog-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const database = createCatalogDatabase();
const storeRepository = database ? new DrizzleStoreRepository(database) : undefined;
const catalogImportService = database ? new CatalogImportService(database) : undefined;
const mediaStore = ProductMediaStore.createFromEnvironment();
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
    isPublic: (request) =>
      ["GET", "HEAD"].includes(request.method) &&
      publicCatalogPaths.some((prefix) => matchesPathPrefix(request.path, prefix)),
  }),
);
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.use("/", createCatalogImportRouter(catalogImportService));
app.use("/", createCatalogRouter(storeRepository, mediaStore));
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
