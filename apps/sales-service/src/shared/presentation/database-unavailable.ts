import type { Response } from "express";

/** Answers the problem every sales route gives while no database is configured. */
export const sendDatabaseUnavailable = (response: Response) =>
  response.status(503).json({
    type: "https://api.pharmacycentral.local/problems/sales-database-not-configured",
    title: "Sales database is not configured",
    status: 503,
  });
