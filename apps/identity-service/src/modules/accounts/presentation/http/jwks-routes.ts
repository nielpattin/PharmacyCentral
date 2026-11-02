import type { AccessTokenSigner } from "@pharmacy/auth";
import { Router } from "express";

/** `GET /.well-known/jwks.json`: the public key set every service verifies access tokens against. Unauthenticated. */
export const createJwksRouter = (signer: AccessTokenSigner): Router => {
  const router = Router();

  router.get("/.well-known/jwks.json", (_request, response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json(signer.jwks());
  });

  return router;
};
