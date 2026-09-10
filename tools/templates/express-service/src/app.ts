import express from "express";
import type { RequestHandler } from "express";

const healthHandler: RequestHandler = (_request, response) => {
  response.json({ status: "ok" });
};

export const createApp = (): express.Express => {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.get("/health/live", healthHandler);
  app.get("/health/ready", healthHandler);

  app.use((_request, response) => {
    response.status(404).json({
      type: "https://api.pharmacycentral.local/problems/not-found",
      title: "Not Found",
      status: 404,
    });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({
      type: "https://api.pharmacycentral.local/problems/internal-error",
      title: "Internal Server Error",
      status: 500,
    });
  });

  return app;
};
