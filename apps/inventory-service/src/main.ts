import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware } from "./middleware/trusted-request.ts";

import { AvailabilityPublisher } from "./modules/availability-publisher.ts";
import { CatalogServiceReferenceResolver } from "./modules/catalog-reference-resolver.ts";
import { createInventoryImportRouter } from "./modules/inventory-import-routes.ts";
import { InventoryImportService } from "./modules/inventory-import-service.ts";
import { createInventoryRouter } from "./modules/inventory-routes.ts";
import { InventoryRepository } from "./modules/inventory-repository.ts";
import { createProcurementRouter } from "./modules/procurement-routes.ts";
import { ProcurementRepository } from "./modules/procurement-repository.ts";
import { createInventoryDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "inventory-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const catalogServiceUrl = process.env.CATALOG_SERVICE_URL;
if (!catalogServiceUrl)
  throw new Error("Missing required environment variable: CATALOG_SERVICE_URL. Please set it in your .env file.");
// Procurement calls the catalog with the shared internal service secret, so a missing one stops the service here.
if (!process.env.INTERNAL_SERVICE_SECRET)
  throw new Error("Missing required environment variable: INTERNAL_SERVICE_SECRET. Please set it in your .env file.");
const database = createInventoryDatabase();
const availabilityPublisher = new AvailabilityPublisher();
await availabilityPublisher
  .start()
  .catch((error: unknown) => logger.warn({ error }, "availability publisher unavailable"));
const repository = database
  ? new InventoryRepository(database, (input) => availabilityPublisher.publish(input))
  : undefined;
const inventoryImportService = database
  ? new InventoryImportService(database, new CatalogServiceReferenceResolver(catalogServiceUrl), (input) =>
      availabilityPublisher.publish(input),
    )
  : undefined;
const procurementRepository = database
  ? new ProcurementRepository(database, async (input) => {
      if (!repository) return;
      const existingBatch = (await repository.listBatches(input.productId)).find(
        (batch) => batch.batchNumber === input.batchNumber,
      );
      const batch =
        existingBatch ??
        (await repository.createBatch({
          productId: input.productId,
          supplierId: input.supplierId,
          batchNumber: input.batchNumber,
          manufacturedDate: input.manufacturedDate ?? null,
          expiryDate: input.expiryDate,
          manufacturer: input.manufacturer ?? null,
        }));
      await repository.recordMovement({
        productId: input.productId,
        productBatchId: batch.id,
        siteId: input.siteId,
        storageLocationId: input.storageLocationId,
        quantityDelta: input.quantity,
        movementType: "GoodsReceipt",
        reason: `Goods receipt ${input.batchNumber}`,
        createdBy: input.actorId,
      });
    })
  : undefined;

app.disable("x-powered-by");
app.use("/inventory/imports", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
// Inventory and procurement routes require a signed identity context minted by identity-service (/auth/context).
app.use(createTrustedRequestMiddleware({ expectedAudience: serviceName }));
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", service: serviceName }),
);
app.use(createInventoryImportRouter(inventoryImportService));
app.use(createInventoryRouter(repository));
app.use(createProcurementRouter(procurementRepository, { catalogServiceUrl }));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
  void availabilityPublisher.close();
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
