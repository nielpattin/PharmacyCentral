import type { AccessTokenVerifier } from "@pharmacy/auth";
import { Router, type Response } from "express";
import { z } from "zod";

import {
  approveSearchSynonymRequestSchema,
  createSearchSynonymRequestSchema,
  updateSearchSynonymRequestSchema,
} from "../../../../contracts/synonyms.ts";
import { requireEmployee, staffActorOf } from "../../../../shared/authorization/access.ts";
import { ROLE_RULES } from "../../../../shared/authorization/policy.ts";
import { SearchSynonymError, type SearchSynonymService } from "./search-synonym-service.ts";

export type SearchSynonymRouteOptions = {
  /** Undefined when no database is configured. Every route then answers 503 after the role check. */
  service: SearchSynonymService | undefined;
  verifier: AccessTokenVerifier;
};

export type ProblemBody = { type: string; title: string; status: number; code: string; detail?: string };

const BASE_PATH = "/products/search-synonyms";
const idParamSchema = z.object({ id: z.string().uuid() });

const problem = (status: number, slug: string, title: string, code: string, detail?: string): ProblemBody => ({
  type: `https://api.pharmacycentral.local/problems/${slug}`,
  title,
  status,
  code,
  ...(detail === undefined ? {} : { detail }),
});

const NOT_FOUND = problem(
  404,
  "search-synonym-not-found",
  "Search synonym group not found",
  "search_synonym_not_found",
);
const INVALID_REQUEST = problem(400, "invalid-request", "Invalid request", "invalid_request");
const UNAVAILABLE = problem(503, "catalog-database-unavailable", "Catalog database is not configured", "unavailable");

const SERVICE_ERRORS: Record<SearchSynonymError["code"], ProblemBody> = {
  search_synonym_not_found: NOT_FOUND,
  version_conflict: problem(409, "version-conflict", "The group changed since you loaded it", "version_conflict"),
  self_approval_forbidden: problem(
    403,
    "self-approval-forbidden",
    "The person who proposed a group cannot approve it",
    "self_approval_forbidden",
    "Bạn không thể duyệt thay đổi của chính mình. Một nhân viên khác phải duyệt.",
  ),
  already_approved: problem(409, "already-approved", "The group is already approved", "already_approved"),
  invalid_request: INVALID_REQUEST,
};

/** Sends a service failure as its problem body. Anything that is not a SearchSynonymError is a bug and goes to Express. */
const sendServiceError = (error: unknown, response: Response): void => {
  if (!(error instanceof SearchSynonymError)) throw error;
  const body = SERVICE_ERRORS[error.code];
  response.status(body.status).json(body);
};

export const createSearchSynonymRouter = (options: SearchSynonymRouteOptions): Router => {
  const router = Router();
  const identity = { verifier: options.verifier };
  // The trusted middleware lets GET /products through without identity, so every route checks the access token and
  // its role here. Platform Admin reads the groups and changes none (see ROLE_RULES).
  const editor = requireEmployee(identity, ROLE_RULES.searchSynonymEditor);
  const approver = requireEmployee(identity, ROLE_RULES.searchSynonymApprover);

  router.get(BASE_PATH, editor, async (_request, response) => {
    if (!options.service) return void response.status(UNAVAILABLE.status).json(UNAVAILABLE);
    response.json({ items: await options.service.list() });
  });

  router.post(BASE_PATH, editor, async (request, response) => {
    const actorId = staffActorOf(response).actorId;
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

  router.put(`${BASE_PATH}/:id`, editor, async (request, response) => {
    const actorId = staffActorOf(response).actorId;
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

  router.post(`${BASE_PATH}/:id/approve`, approver, async (request, response) => {
    const actorId = staffActorOf(response).actorId;
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

  router.delete(`${BASE_PATH}/:id`, editor, async (request, response) => {
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
