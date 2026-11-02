import type { Request } from "express";

/**
 * The access token of the employee who asked, forwarded as it arrived so catalog-service answers its staff-only lists
 * to the person reading the dashboard and applies its own site scope.
 */
export const callerAuthorization = (request: Request): string => {
  const authorization = request.header("authorization");
  if (!authorization)
    throw new Error("A catalog read needs the access token of the employee who asked for the figures.");
  return authorization;
};
