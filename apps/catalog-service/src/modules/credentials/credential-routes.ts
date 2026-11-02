import type { AccessTokenVerifier } from "@pharmacy/auth";
import { Router, type Request, type Response } from "express";

import {
  aiProviders,
  aiProviderCatalog,
  replaceCredentialRequestSchema,
  type CredentialView,
} from "../../contracts/credentials.ts";
import { verifyRequestIdentity } from "../../middleware/trusted-request.ts";
import { ApiKeyRequiredError, type AiCredentialVault } from "./ai-credential-vault.ts";

export type CredentialRouteOptions = {
  vault: AiCredentialVault;
  verifier: AccessTokenVerifier;
  onSettingsChanged?: (() => void) | undefined;
};

const CREDENTIAL_PATH = "/products/search-credential";

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
 * The trusted middleware only checks that the caller is signed in. A key change needs the Platform Admin role, so
 * this route checks the access token itself.
 */
const platformAdminId = async (
  request: Request,
  response: Response,
  options: CredentialRouteOptions,
): Promise<string | undefined> => {
  const context = await verifyRequestIdentity(request, options.verifier);
  if (context?.actorType !== "employee" || !context.roles.includes("Platform Admin")) {
    response.status(403).json(FORBIDDEN);
    return undefined;
  }
  return context.actorId;
};

export const createCredentialRouter = (options: CredentialRouteOptions): Router => {
  const router = Router();

  // The save already succeeded, so a failed reindex trigger must not turn it into an error. Search stays keyword-only until the next sweep.
  const notifySettingsChanged = (): void => {
    try {
      options.onSettingsChanged?.();
    } catch {}
  };

  router.get(CREDENTIAL_PATH, async (request, response) => {
    if (!await platformAdminId(request, response, options)) return;
    const view: CredentialView = {
      providers: aiProviders.map((id) => ({ id, ...aiProviderCatalog[id] })),
      current: await options.vault.status(),
    };
    response.json(view);
  });

  router.put(CREDENTIAL_PATH, async (request, response) => {
    const actorId = await platformAdminId(request, response, options);
    if (!actorId) return;
    const body = replaceCredentialRequestSchema.safeParse(request.body);
    if (!body.success) {
      response.status(400).json(BAD_REQUEST);
      return;
    }
    try {
      await options.vault.replace(body.data, actorId);
    } catch (error) {
      if (!(error instanceof ApiKeyRequiredError)) throw error;
      response.status(400).json(API_KEY_REQUIRED);
      return;
    }
    notifySettingsChanged();
    const view: CredentialView = {
      providers: aiProviders.map((id) => ({ id, ...aiProviderCatalog[id] })),
      current: await options.vault.status(),
    };
    response.json(view);
  });

  router.delete(CREDENTIAL_PATH, async (request, response) => {
    if (!await platformAdminId(request, response, options)) return;
    await options.vault.clear();
    notifySettingsChanged();
    response.status(204).end();
  });

  return router;
};
