import { randomUUID } from "node:crypto";

import type { Request } from "express";

import { actorSiteIds, signInternalIdentityContext } from "../middleware/trusted-request.ts";
import { actorRoles } from "./operations-access.ts";

const CATALOG_AUDIENCE = "catalog-service";
const CONTEXT_TTL_MS = 30_000;

/**
 * Signs the verified employee of this request again for catalog-service, with the same actor, roles and sites, so the
 * catalog answers its staff-only lists to the person reading the dashboard and applies its own site scope. The keys are
 * written in the order the services' schema parses them: a service checks the signature over the context it
 * re-serializes in that order.
 */
export const signCatalogIdentity = (request: Request, now = new Date()): string => {
  const secret = process.env.INTERNAL_IDENTITY_SECRET;
  if (!secret)
    throw new Error(
      "Missing required environment variable: INTERNAL_IDENTITY_SECRET. Please set it in your .env file.",
    );
  const actorId = request.header("x-actor-id");
  if (!actorId) throw new Error("A catalog read needs the employee who asked for the figures.");
  const requestId = request.header("x-request-id") ?? randomUUID();
  return signInternalIdentityContext(
    {
      version: "v1",
      requestId,
      correlationId: request.header("x-correlation-id") ?? requestId,
      actorId,
      actorType: "employee",
      roles: actorRoles(request),
      siteIds: actorSiteIds(request) ?? [],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
      audience: CATALOG_AUDIENCE,
    },
    secret,
  );
};
