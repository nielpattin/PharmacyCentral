import type { Request } from "express";

/**
 * The `Authorization` header the caller sent, to forward to catalog-service so the catalog applies its own role and site
 * rules to what a lookup reads on behalf of the employee who started the request.
 */
export const callerAuthorization = (request: Request): string => {
  const authorization = request.header("authorization");
  if (!authorization) throw new Error("A catalog lookup needs the employee who started the request.");
  return authorization;
};
