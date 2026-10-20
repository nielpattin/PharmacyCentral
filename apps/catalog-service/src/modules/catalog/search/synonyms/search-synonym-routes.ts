import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  approveSearchSynonymRequestSchema,
  createSearchSynonymRequestSchema,
  updateSearchSynonymRequestSchema,
} from "../../../../contracts/synonyms.ts";
import { verifyInternalIdentityContext } from "../../../../middleware/trusted-request.ts";
import { SearchSynonymError, type SearchSynonymService } from "./search-synonym-service.ts";

export type SearchSynonymRouteOptions = {
  /** Undefined when no database is configured. Every route then answers 503 after the role check. */
  service: SearchSynonymService | undefined;
  identitySecret: string;
  audience: string;
};

export type ProblemBody = { type: string; title: string; status: number; code: string };

const BASE_PATH = "/products/search-synonyms";
const idParamSchema = z.object({ id: z.string().uuid() });
const EDITOR_ROLES: readonly string[] = ["Platform Admin", "Pharmacy Manager", "Pharmacist"];

const problem = (status: number, slug: string, title: string, code: string): ProblemBody => ({
  type: `https://api.pharmacycentral.local/problems/${slug}`,
  title,
  status,
  code,
});

const UNAUTHORIZED = problem(401, "unauthorized", "Sign in required", "unauthorized");
const FORBIDDEN = problem(403, "forbidden", "Search synonym access required", "forbidden");
const INVALID_REQUEST = problem(400, "invalid-request", "Invalid request", "invalid_request");
const NOT_FOUND = problem(
  404,
  "search-synonym-not-found",
  "Search synonym group not found",
  "search_synonym_not_found",
);
const UNAVAILABLE = problem(503, "catalog-database-unavailable", "Catalog database is not configured", "unavailable");

const SERVICE_ERRORS: Record<SearchSynonymError["code"], ProblemBody> = {
  search_synonym_not_found: NOT_FOUND,
  version_conflict: problem(409, "version-conflict", "The group changed since you loaded it", "version_conflict"),
  self_review_forbidden: problem(
    409,
    "self-review-forbidden",
    "The person who submitted a group cannot approve it",
    "self_review_forbidden",
  ),
  already_approved: problem(409, "already-approved", "The group is already approved", "already_approved"),
  invalid_request: INVALID_REQUEST,
};

/**
 * The trusted middleware lets GET /products through without identity, and it checks only that the caller is signed in
 * on writes. Every route here checks the signed context and the editor roles itself.
 */
const editorId = (request: Request, response: Response, options: SearchSynonymRouteOptions): string | undefined => {
  const context = verifyInternalIdentityContext(
    request.header("x-internal-identity-context"),
    options.identitySecret,
    new Date(),
    options.audience,
  );
  if (!context) {
    response.status(401).json(UNAUTHORIZED);
    return undefined;
  }
  const canEdit = context.actorType === "employee" && context.roles.some((role) => EDITOR_ROLES.includes(role));
  if (!canEdit || !context.actorId) {
    response.status(403).json(FORBIDDEN);
    return undefined;
  }
  return context.actorId;
};

/** Sends a service failure as its problem body. Anything that is not a SearchSynonymError is a bug and goes to Express. */
const sendServiceError = (error: unknown, response: Response): void => {
  if (!(error instanceof SearchSynonymError)) throw error;
  const body = SERVICE_ERRORS[error.code];
  response.status(body.status).json(body);
};

export const createSearchSynonymRouter = (options: SearchSynonymRouteOptions): Router => {
  const router = Router();

  router.get(BASE_PATH, async (request, response) => {
    if (!editorId(request, response, options)) return;
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    response.json({ items: await options.service.list() });
  });

  router.post(BASE_PATH, async (request, response) => {
    const actorId = editorId(request, response, options);
    if (!actorId) return;
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    const body = createSearchSynonymRequestSchema.safeParse(request.body);
    if (!body.success) return void response.status(INVALID_REQUEST.status).json(INVALID_REQUEST);
    try {
      const group = await options.service.create({ actorId, terms: body.data.terms });
      response.status(201).json(group);
    } catch (error) {
      sendServiceError(error, response);
    }
  });

  router.put(`${BASE_PATH}/:id`, async (request, response) => {
    const actorId = editorId(request, response, options);
    if (!actorId) return;
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return void response.status(NOT_FOUND.status).json(NOT_FOUND);
    const body = updateSearchSynonymRequestSchema.safeParse(request.body);
    if (!body.success) return void response.status(INVALID_REQUEST.status).json(INVALID_REQUEST);
    try {
      const group = await options.service.update({
        actorId,
        id: id.data.id,
        terms: body.data.terms,
        version: body.data.version,
      });
      response.json(group);
    } catch (error) {
      sendServiceError(error, response);
    }
  });

  router.post(`${BASE_PATH}/:id/approve`, async (request, response) => {
    const actorId = editorId(request, response, options);
    if (!actorId) return;
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return void response.status(NOT_FOUND.status).json(NOT_FOUND);
    const body = approveSearchSynonymRequestSchema.safeParse(request.body);
    if (!body.success) return void response.status(INVALID_REQUEST.status).json(INVALID_REQUEST);
    try {
      const group = await options.service.approve({ actorId, id: id.data.id, version: body.data.version });
      response.json(group);
    } catch (error) {
      sendServiceError(error, response);
    }
  });

  router.delete(`${BASE_PATH}/:id`, async (request, response) => {
    if (!editorId(request, response, options)) return;
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    const id = idParamSchema.safeParse(request.params);
    if (!id.success) return void response.status(NOT_FOUND.status).json(NOT_FOUND);
    try {
      await options.service.delete({ id: id.data.id });
      response.status(204).end();
    } catch (error) {
      sendServiceError(error, response);
    }
  });

  return router;
};
