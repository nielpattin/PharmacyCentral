import type { AccessTokenVerifier } from "@pharmacy/auth";
import express from "express";
import type { RequestHandler } from "express";

import { createTrustedRequestMiddleware } from "./middleware/trusted-request.ts";
import type { ChatDependencies } from "./modules/chat/chat-service.ts";
import { createChatRouter } from "./modules/chat/chat-routes.ts";
import { createCredentialRouter, type CredentialRouteOptions } from "./modules/credentials/credential-routes.ts";
import { createAiBudgetRouter, type AiBudgetRouteOptions } from "./modules/ai-budget/ai-budget-routes.ts";
import type { Logger } from "./logger.ts";

const healthHandler: RequestHandler = (_request, response) => {
  response.json({ status: "ok" });
};

export type AppOptions = {
  deps: ChatDependencies;
  verifier: AccessTokenVerifier;
  credentials: readonly Omit<CredentialRouteOptions, "verifier">[];
  /** The AI spend limits and price table (Platform Admin). Omitted only in tests that do not exercise them. */
  aiBudget?: Omit<AiBudgetRouteOptions, "verifier">;
  logger: Logger;
};

export const createApp = ({ deps, verifier, credentials, aiBudget, logger }: AppOptions): express.Express => {
  const app = express();

  app.disable("x-powered-by");
  app.get("/health/live", healthHandler);
  app.get("/health/ready", healthHandler);
  app.use(express.json({ limit: "32kb" }));
  app.use(createTrustedRequestMiddleware({ verifier }));
  for (const options of credentials) {
    app.use(createCredentialRouter({ ...options, verifier }));
  }
  if (aiBudget) {
    app.use(createAiBudgetRouter({ ...aiBudget, verifier }));
  }
  app.use(createChatRouter({ deps, logger }));

  app.use((_request, response) => {
    response.status(404).json({
      type: "https://api.pharmacycentral.local/problems/not-found",
      title: "Not Found",
      status: 404,
    });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    logger.error({ err: error }, "request failed");
    response.status(500).json({
      type: "https://api.pharmacycentral.local/problems/internal-error",
      title: "Internal Server Error",
      status: 500,
    });
  });

  return app;
};
