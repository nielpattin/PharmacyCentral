import "./telemetry.ts"; // Must load first so the OpenTelemetry instrumentations can patch libraries.
import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, IDENTITY_PUBLIC_AUTH_PATHS } from "./middleware/trusted-request.ts";
import { createCsrfMiddleware } from "./middleware/csrf.ts";

import { createAuditRecorder, noAuditRecorder } from "./modules/outbox/audit-recorder.ts";
import { IdentityOutboxPublisher } from "./modules/outbox/outbox-publisher.ts";
import { createIdentityDatabase } from "./shared/infrastructure/database.ts";
import {
  createAccountRouter,
  createAdminRouter,
  createCustomerRouter,
  createInternalCustomerRouter,
} from "./modules/accounts/presentation/http/account-routes.ts";
import {
  createAccountService,
  createAuthRateLimit,
  createGoogleSignIn,
  readPositiveIntegerEnv,
} from "./bootstrap/dependencies.ts";

const serviceName = "identity-service";
const logger = createLogger({ name: serviceName });
const app = express();
// The gateway in front forwards the client address in X-Forwarded-For. Only the hops this service sits behind are
// trusted, so a client cannot write its own address into the rate limit key.
app.set("trust proxy", readPositiveIntegerEnv("TRUST_PROXY_HOPS"));
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const cookieSecureEnv = process.env.COOKIE_SECURE;
if (!cookieSecureEnv)
  throw new Error("Missing required environment variable: COOKIE_SECURE. Please set it in your .env file.");
if (cookieSecureEnv !== "true" && cookieSecureEnv !== "false")
  throw new Error('Invalid COOKIE_SECURE: expected "true" or "false".');
const cookieSecure = cookieSecureEnv === "true";
const port = Number.parseInt(portStr, 10);
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!rabbitmqUrl)
  throw new Error("Missing required environment variable: RABBITMQ_URL. Please set it in your .env file.");
const database = createIdentityDatabase();
const outboxPublisher = database ? new IdentityOutboxPublisher(database, logger, rabbitmqUrl) : undefined;
outboxPublisher?.start();
const audit = database ? createAuditRecorder(database, logger) : noAuditRecorder;
const accountService = createAccountService(database);
const googleSignIn = createGoogleSignIn();
const authRateLimit = createAuthRateLimit();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(
  createTrustedRequestMiddleware({
    expectedAudience: serviceName,
    publicPaths: [...IDENTITY_PUBLIC_AUTH_PATHS, "/admin", "/customers"],
  }),
);
app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
app.get("/health/ready", (_request, response) =>
  response.status(database ? 200 : 503).json({ status: database ? "ok" : "degraded", service: serviceName }),
);
app.use(createCsrfMiddleware());
app.use("/auth", createAccountRouter(accountService, googleSignIn, authRateLimit.limiter, audit, cookieSecure));
app.use("/admin", createAdminRouter(accountService, audit));
app.use("/customers", createCustomerRouter(accountService));
app.use("/internal", createInternalCustomerRouter(accountService));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
  void outboxPublisher?.close().then(() => database?.pool.end());
  authRateLimit.redis.disconnect();
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
