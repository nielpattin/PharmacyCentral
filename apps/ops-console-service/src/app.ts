import express, { type Express } from "express";

import type { Logger } from "./logger.ts";
import { requirePlatformAdmin } from "./middleware/platform-admin.ts";
import { createSystemRouter, type DashboardLink } from "./modules/system/system-routes.ts";
import type { Probes } from "./modules/system/probes.ts";

export type AppOptions = {
  identitySecret: string;
  audience: string;
  probes: Probes;
  links: DashboardLink[];
  logger: Logger;
};

export const createApp = (options: AppOptions): Express => {
  const app = express();
  app.disable("x-powered-by");
  const serviceName = "ops-console-service";
  app.get("/health/live", (_request, response) => response.json({ status: "ok", service: serviceName }));
  app.get("/health/ready", (_request, response) => response.json({ status: "ok", service: serviceName }));
  app.use(requirePlatformAdmin({ identitySecret: options.identitySecret, audience: options.audience }));
  app.use(createSystemRouter(options.probes, options.links));
  app.use((_request, response) => {
    response.status(404).json({ title: "Not found", status: 404, code: "not_found" });
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    options.logger.error({ error }, "request failed");
    response.status(500).json({ title: "Internal server error", status: 500, code: "internal_error" });
  });
  return app;
};
