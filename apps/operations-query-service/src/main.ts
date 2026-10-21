import "./telemetry.ts"; // Must load first so the OpenTelemetry instrumentations can patch libraries.
import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware } from "./middleware/trusted-request.ts";

import { RabbitMqEventConsumer } from "./modules/rabbitmq-event-consumer.ts";
import { createOperationsRouter } from "./modules/operations-routes.ts";
import { OperationsRepository } from "./modules/operations-repository.ts";
import { createOperationsDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "operations-query-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const catalogUrl = process.env.CATALOG_SERVICE_URL;
if (!catalogUrl)
  throw new Error("Missing required environment variable: CATALOG_SERVICE_URL. Please set it in your .env file.");
const inventoryUrl = process.env.INVENTORY_SERVICE_URL;
if (!inventoryUrl)
  throw new Error("Missing required environment variable: INVENTORY_SERVICE_URL. Please set it in your .env file.");
const salesUrl = process.env.SALES_SERVICE_URL;
if (!salesUrl)
  throw new Error("Missing required environment variable: SALES_SERVICE_URL. Please set it in your .env file.");
// The live dashboard reads the other services with the shared internal service secret.
if (!process.env.INTERNAL_SERVICE_SECRET)
  throw new Error("Missing required environment variable: INTERNAL_SERVICE_SECRET. Please set it in your .env file.");
const database = createOperationsDatabase();
const repository = database ? new OperationsRepository(database, { catalogUrl, inventoryUrl, salesUrl }) : undefined;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!rabbitmqUrl)
  throw new Error("Missing required environment variable: RABBITMQ_URL. Please set it in your .env file.");
const eventConsumer = repository ? new RabbitMqEventConsumer(repository, logger, rabbitmqUrl) : undefined;
eventConsumer?.start();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
// Operational query routes require a signed identity context minted by identity-service (/auth/context).
app.use(createTrustedRequestMiddleware({ expectedAudience: serviceName }));
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", service: serviceName }),
);
app.use(createOperationsRouter(repository));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
  void eventConsumer?.close();
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
