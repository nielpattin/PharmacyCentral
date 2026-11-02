import { Router, type Request, type Response } from "express";

import {
  aiProviders,
  aiProviderCatalog,
  replaceCredentialRequestSchema,
  type CredentialView,
} from "../../contracts/credentials.ts";
import { ACTOR_ROLES_HEADER } from "../../middleware/trusted-request.ts";
import { sendDatabaseUnavailable as unavailable } from "../../shared/presentation/database-unavailable.ts";
import { ApiKeyRequiredError, type AiCredentialVault } from "./ai-credential-vault.ts";

export type CredentialRouteOptions = {
  vault: AiCredentialVault | undefined;
};

const CREDENTIAL_PATH = "/prescriptions/intake-credential";

const FORBIDDEN = {
  type: "https://api.pharmacycentral.local/problems/forbidden",
  title: "Platform admin access required",
  status: 403,
  code: "forbidden",
};

const BAD_REQUEST = {
  type: "https://api.pharmacycentral.local/problems/invalid-request",
  title: "Invalid request",
  status: 400,
  code: "invalid_request",
};

const API_KEY_REQUIRED = {
  type: "https://api.pharmacycentral.local/problems/api-key-required",
  title: "An API key is required",
  status: 400,
  code: "api_key_required",
};

/**
 * The trusted middleware checks only that the caller is signed in, so this route checks the Platform Admin role
 * itself, from the roles the middleware took from the access token.
 */
const platformAdminId = (request: Request, response: Response): string | undefined => {
  const actorId = request.header("x-actor-id");
  const roles = request.header(ACTOR_ROLES_HEADER)?.split(",") ?? [];
  if (request.header("x-actor-type") !== "employee" || !actorId || !roles.includes("Platform Admin")) {
    response.status(403).json(FORBIDDEN);
    return undefined;
  }
  return actorId;
};

export const createCredentialRouter = (options: CredentialRouteOptions): Router => {
  const router = Router();

  router.get(CREDENTIAL_PATH, async (request, response) => {
    const vault = options.vault;
    if (!vault) return unavailable(response);
    if (!platformAdminId(request, response)) return;
    const view: CredentialView = {
      providers: aiProviders.map((id) => ({ id, ...aiProviderCatalog[id] })),
      current: await vault.status(),
    };
    return response.json(view);
  });

  router.put(CREDENTIAL_PATH, async (request, response) => {
    const vault = options.vault;
    if (!vault) return unavailable(response);
    const actorId = platformAdminId(request, response);
    if (!actorId) return;
    const body = replaceCredentialRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json(BAD_REQUEST);
      return;
    }
    try {
      await vault.replace(body.data, actorId);
    } catch (error) {
      if (!(error instanceof ApiKeyRequiredError)) throw error;
      return response.status(400).json(API_KEY_REQUIRED);
    }
    const view: CredentialView = {
      providers: aiProviders.map((id) => ({ id, ...aiProviderCatalog[id] })),
      current: await vault.status(),
    };
    return response.json(view);
  });

  router.delete(CREDENTIAL_PATH, async (request, response) => {
    const vault = options.vault;
    if (!vault) return unavailable(response);
    if (!platformAdminId(request, response)) return;
    await vault.clear();
    return response.status(204).end();
  });

  return router;
};
