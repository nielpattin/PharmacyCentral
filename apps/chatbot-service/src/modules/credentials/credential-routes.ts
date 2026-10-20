import { Router, type Request, type Response } from "express";

import {
  aiProviderCatalog,
  replaceCredentialRequestSchema,
  type AiProviderList,
  type CredentialView,
} from "../../contracts/credentials.ts";
import { verifyInternalIdentityContext } from "../../middleware/trusted-request.ts";
import { ApiKeyRequiredError, type AiCredentialVault } from "./ai-credential-vault.ts";

export const CHATBOT_CREDENTIAL_PATH = "/chatbot/credential";
export const INTENT_GATE_CREDENTIAL_PATH = "/chatbot/intent-gate-credential";

export type CredentialRouteOptions = {
  path: string;
  /** The providers this feature may use. The view lists them and the PUT body must name one of them. */
  providers: AiProviderList;
  vault: AiCredentialVault;
  identitySecret: string;
  audience: string;
};

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
 * The trusted middleware only proves a signed-in caller. The local gateway has no authorizer, so this route reads the
 * signed context itself and requires Platform Admin.
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
  const requestSchema = replaceCredentialRequestSchema(options.providers);

  const view = async (): Promise<CredentialView> => ({
    providers: options.providers.map((id) => ({ id, ...aiProviderCatalog[id] })),
    current: await options.vault.status(),
  });

  router.get(options.path, async (request, response) => {
    if (!platformAdminId(request, response, options)) return;
    response.json(await view());
  });

  router.put(options.path, async (request, response) => {
    const actorId = platformAdminId(request, response, options);
    if (!actorId) return;
    const body = requestSchema.safeParse(request.body);
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
    response.json(await view());
  });

  router.delete(options.path, async (request, response) => {
    if (!platformAdminId(request, response, options)) return;
    await options.vault.clear();
    response.status(204).end();
  });

  return router;
};
