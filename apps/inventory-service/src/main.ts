// telemetry.ts must load first so the OpenTelemetry instrumentations can patch libraries before they are imported.
import "./telemetry.ts";
import { createAccessTokenVerifier } from "@pharmacy/auth";
import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware } from "./middleware/trusted-request.ts";
import { BusinessRuleError } from "./shared/business-rule-error.ts";

import { CatalogServiceReferenceResolver } from "./modules/catalog-reference-resolver.ts";
import { ExpiryAvailabilitySweeper } from "./modules/expiry-availability-sweeper.ts";
import { createInventoryImportRouter } from "./modules/inventory-import-routes.ts";
import { InventoryImportService } from "./modules/inventory-import-service.ts";
import { createInventoryRouter } from "./modules/inventory-routes.ts";
import { InventoryRepository } from "./modules/inventory-repository.ts";
import { createAuditMiddleware } from "./modules/audit/audit-middleware.ts";
import { createAuditRecorder } from "./modules/audit/audit-recorder.ts";
import { INVENTORY_AUDIT_RULES } from "./modules/audit/audit-rules.ts";
import { InventoryOutboxPublisher } from "./modules/outbox-publisher.ts";
import { createProcurementRouter } from "./modules/procurement-routes.ts";
import { ProcurementRepository } from "./modules/procurement-repository.ts";
import { createInventoryDatabase } from "./shared/infrastructure/database.ts";
import { ActionPlanRepository } from "./modules/action-plans/action-plan-repository.ts";
import { createActionPlanRouter } from "./modules/action-plans/action-plan-routes.ts";
import { IdentityEmployeeClient } from "./modules/action-plans/identity-employee-client.ts";
import { ActionPlanAutoCreator } from "./modules/action-plans/action-plan-auto-creator.ts";
import { ActionPlanAutoSweeper } from "./modules/action-plans/action-plan-auto-sweeper.ts";
import { CatalogBasePriceClient } from "./modules/action-plans/catalog-base-prices-client.ts";
import { DEFAULT_REPLENISHMENT_PARAMS, replenishmentSuggestions } from "./modules/replenishment-suggestions.ts";

const serviceName = "inventory-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const catalogServiceUrl = process.env.CATALOG_SERVICE_URL;
if (!catalogServiceUrl)
  throw new Error("Missing required environment variable: CATALOG_SERVICE_URL. Please set it in your .env file.");
// Action plans check every owner against identity-service, so a missing URL stops the service here.
const identityServiceUrl = process.env.IDENTITY_SERVICE_URL;
if (!identityServiceUrl)
  throw new Error("Missing required environment variable: IDENTITY_SERVICE_URL. Please set it in your .env file.");
// Every request is checked against the identity-service key set, so a missing URL stops the service here.
const identityJwksUrl = process.env.IDENTITY_JWKS_URL;
if (!identityJwksUrl)
  throw new Error("Missing required environment variable: IDENTITY_JWKS_URL. Please set it in your .env file.");
const accessTokenVerifier = createAccessTokenVerifier({ jwks: identityJwksUrl });
// Procurement calls the catalog with the shared internal service secret, so a missing one stops the service here.
if (!process.env.INTERNAL_SERVICE_SECRET)
  throw new Error("Missing required environment variable: INTERNAL_SERVICE_SECRET. Please set it in your .env file.");
const database = createInventoryDatabase();
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!rabbitmqUrl)
  throw new Error("Missing required environment variable: RABBITMQ_URL. Please set it in your .env file.");
const outboxPublisher = database ? new InventoryOutboxPublisher(database, logger, rabbitmqUrl) : undefined;
outboxPublisher?.start();
const repository = database ? new InventoryRepository(database) : undefined;
const actionPlanRepository = database ? new ActionPlanRepository(database) : undefined;
const employeeDirectory = new IdentityEmployeeClient(identityServiceUrl);
// Expiry changes what a site can sell with no movement on the shelf, so it needs its own periodic recompute.
const expiryAvailabilitySweeper = repository ? new ExpiryAvailabilitySweeper(repository, logger) : undefined;
expiryAvailabilitySweeper?.start();
const inventoryImportService = database
  ? new InventoryImportService(
      database,
      (authorization) => new CatalogServiceReferenceResolver(catalogServiceUrl, authorization),
    )
  : undefined;
const procurementRepository = database
  ? new ProcurementRepository(database, async (input) => {
      if (!repository) return;
      const existingBatch = (await repository.listBatches({ productId: input.productId })).rows.find(
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
          createdBy: input.actorId,
        }));
      await repository.recordMovement({
        productId: input.productId,
        productBatchId: batch.id,
        siteId: input.siteId,
        storageLocationId: input.storageLocationId,
        quantityDelta: input.quantity,
        movementType: "GoodsReceipt",
        reason: `Goods receipt ${input.batchNumber}`,
        occurredAtUtc: input.receivedAt.toISOString(),
        referenceType: "GoodsReceipt",
        referenceId: input.goodsReceiptId,
        createdBy: input.actorId,
      });
    })
  : undefined;

// The system creates the action plan of every alert and gives it an owner (BR-PLAN-001); nobody has to ask for one.
const catalogBasePrices = new CatalogBasePriceClient(catalogServiceUrl);
const actionPlanAutoSweeper =
  database && repository && procurementRepository && actionPlanRepository
    ? new ActionPlanAutoSweeper(
        new ActionPlanAutoCreator(
          {
            stockHealth: (now) =>
              repository.stockHealth({ from: new Date(now.getTime() - 86_400_000), to: now, asOf: now }),
            expiringBatches: (through) => repository.expiringBatches(through),
            replenishmentSuggestions: async (siteId, now) =>
              replenishmentSuggestions({
                ...(await procurementRepository.replenishmentInputs({
                  siteId,
                  windowStart: new Date(now.getTime() - DEFAULT_REPLENISHMENT_PARAMS.windowDays * 86_400_000),
                  now,
                })),
                params: DEFAULT_REPLENISHMENT_PARAMS,
              }),
            listProducts: () => catalogBasePrices.listProducts(),
          },
          actionPlanRepository,
          employeeDirectory,
          createAuditRecorder(database, logger),
          logger,
        ),
        logger,
      )
    : undefined;
actionPlanAutoSweeper?.start();

app.disable("x-powered-by");
app.use("/inventory/imports", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
// Inventory and procurement routes require the access token identity-service issues, verified against its JWKS.
app.use(createTrustedRequestMiddleware({ verifier: accessTokenVerifier }));
if (database) app.use(createAuditMiddleware(INVENTORY_AUDIT_RULES, createAuditRecorder(database, logger)));
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", service: serviceName }),
);
app.use(createInventoryImportRouter(inventoryImportService));
app.use(createInventoryRouter(repository));
app.use(createActionPlanRouter(actionPlanRepository, { employees: employeeDirectory }));
app.use(createProcurementRouter(procurementRepository, { catalogServiceUrl }));
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
  expiryAvailabilitySweeper?.close();
  actionPlanAutoSweeper?.close();
  void outboxPublisher?.close();
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
