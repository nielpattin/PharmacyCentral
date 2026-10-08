import express from "express";
import { createServer } from "node:http";

import { createLogger } from "./logger.ts";
import { createTrustedRequestMiddleware, IDENTITY_PUBLIC_AUTH_PATHS } from "./middleware/trusted-request.ts";
import { createCsrfMiddleware } from "./middleware/csrf.ts";

import { createIdentityDatabase } from "./shared/infrastructure/database.ts";
import {
  createAccountRouter,
  createAdminRouter,
  createCustomerRouter,
  createInternalCustomerRouter,
} from "./modules/accounts/presentation/http/account-routes.ts";
import { createAccountService, createGoogleSignIn } from "./bootstrap/dependencies.ts";

const serviceName = "identity-service";
const logger = createLogger({ name: serviceName });
const app = express();
const portStr = process.env.PORT;
if (!portStr) throw new Error("Missing required environment variable: PORT. Please set it in your .env file.");
const port = Number.parseInt(portStr, 10);
const database = createIdentityDatabase();
const accountService = createAccountService(database);
const googleSignIn = createGoogleSignIn();

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
app.use("/auth", createAccountRouter(accountService, googleSignIn));
app.use("/admin", createAdminRouter(accountService));
app.use("/customers", createCustomerRouter(accountService));
app.use("/internal", createInternalCustomerRouter(accountService));
app.use((_request, response) => response.status(404).json({ title: "Not Found", status: 404 }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logger.error({ error }, "unhandled request error");
  response.status(500).json({ title: "Internal Server Error", status: 500 });
});

const server = createServer(app);
server.on("close", () => {
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
