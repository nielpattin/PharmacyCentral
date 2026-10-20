import { Router, type Request, type Response } from "express";

import {
  aiProviders,
  aiProviderCatalog,
  replaceCredentialRequestSchema,
  type CredentialView,
} from "../../contracts/credentials.ts";
import { verifyInternalIdentityContext } from "../../middleware/trusted-request.ts";
import { sendDatabaseUnavailable as unavailable } from "../../shared/presentation/database-unavailable.ts";
import { ApiKeyRequiredError, type AiCredentialVault } from "./ai-credential-vault.ts";

export type CredentialRouteOptions = {
  vault: AiCredentialVault | undefined;
  identitySecret: string;
  audience: string;
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
 * The trusted middleware checks only that the caller is signed in. The local gateway has no authorizer, so this route
 * checks the Platform Admin role itself.
 */
const platformAdminId = (request: Request, response: Response, options: CredentialRouteOptions): string | undefined => {
  const context = verifyInternalIdentityContext(
    request.header("x-internal-identity-context"),
    options.identitySecret,
    new Date(),
    options.audience,
  );
  if (context?.actorType !== "employee" || !context.actorId || !context.roles.includes("Platform Admin")) {
    response.status(403).json(FORBIDDEN);
    return undefined;
  }
  return context.actorId;
};

export const createCredentialRouter = (options: CredentialRouteOptions): Router => {
  const router = Router();

  router.get(CREDENTIAL_PATH, async (request, response) => {
    const vault = options.vault;
    if (!vault) return unavailable(response);
    if (!platformAdminId(request, response, options)) return;
    const view: CredentialView = {
      providers: aiProviders.map((id) => ({ id, ...aiProviderCatalog[id] })),
      current: await vault.status(),
    };
    return response.json(view);
  });

  router.put(CREDENTIAL_PATH, async (request, response) => {
    const vault = options.vault;
    if (!vault) return unavailable(response);
    const actorId = platformAdminId(request, response, options);
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
    if (!platformAdminId(request, response, options)) return;
    await vault.clear();
    return response.status(204).end();
  });

  return router;
};
