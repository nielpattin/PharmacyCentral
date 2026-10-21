// Must load first so the OpenTelemetry instrumentations can patch libraries imported below.
import "./telemetry.ts";

import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware } from "./middleware/trusted-request.ts";

import { PaymentOutboxPublisher } from "./modules/outbox-publisher.ts";
import { applyWebhook, createPaymentRouter } from "./modules/payment-routes.ts";
import { PaymentRepository } from "./modules/payment-repository.ts";
import { SePayWebhookVerifier } from "./modules/sepay/sepay-webhook-verifier.ts";
import { createPaymentDatabase } from "./shared/infrastructure/database.ts";

const serviceName = "payment-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const sePaySecret = process.env.SEPAY_WEBHOOK_SECRET;
if (!sePaySecret)
  throw new Error("Missing required environment variable: SEPAY_WEBHOOK_SECRET. Please set it in your .env file.");
const sePayVerifier = new SePayWebhookVerifier(sePaySecret);
const salesServiceUrl = process.env.SALES_SERVICE_URL;
if (!salesServiceUrl)
  throw new Error("Missing required environment variable: SALES_SERVICE_URL. Please set it in your .env file.");
const catalogServiceUrl = process.env.CATALOG_SERVICE_URL;
if (!catalogServiceUrl)
  throw new Error("Missing required environment variable: CATALOG_SERVICE_URL. Please set it in your .env file.");
if (!process.env.INTERNAL_SERVICE_SECRET)
  throw new Error("Missing required environment variable: INTERNAL_SERVICE_SECRET. Please set it in your .env file.");
const database = createPaymentDatabase();
const repository = database ? new PaymentRepository(database) : undefined;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!rabbitmqUrl)
  throw new Error("Missing required environment variable: RABBITMQ_URL. Please set it in your .env file.");
const outboxPublisher = database ? new PaymentOutboxPublisher(database, logger, rabbitmqUrl) : undefined;
outboxPublisher?.start();

app.disable("x-powered-by");
app.post(
  "/payments/sepay/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (request, response, next) => {
    const signature =
      typeof request.headers["x-sepay-signature"] === "string" ? request.headers["x-sepay-signature"] : undefined;
    const timestamp =
      typeof request.headers["x-sepay-timestamp"] === "string" ? request.headers["x-sepay-timestamp"] : undefined;
    if (!sePayVerifier.verify(request.body as Buffer, signature, timestamp)) {
      response.status(401).json({ title: "Invalid webhook signature", status: 401, code: "invalid_signature" });
      return;
    }
    try {
      const payload: unknown = JSON.parse((request.body as Buffer).toString("utf8"));
      const result = await applyWebhook(repository, payload);
      // SePay only records a delivery as successful for HTTP 200 with a body of exactly {"success": true}.
      if (result) logger.info({ result }, "sepay webhook applied");
      else logger.warn({ payload }, "sepay webhook did not identify an invoice");
      response.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);
app.use(express.json({ limit: "1mb" }));
// Payment browser routes require a signed identity context. The verified SePay webhook is registered above.
app.use(createTrustedRequestMiddleware({ expectedAudience: serviceName }));
app.use(createPaymentRouter(repository, { salesServiceUrl, catalogServiceUrl }));
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", service: serviceName }),
);
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
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
