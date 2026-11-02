import type { RequestHandler } from "express";

const IDENTITY_HEADERS = ["x-actor-id", "x-actor-type", "x-actor-site-ids"];

/**
 * The SePay webhook is called by an external provider, never by an identity-carrying gateway, so no identity header
 * may reach its handler. Removing them here keeps the route safe if a handler ever starts reading one.
 */
export const stripIdentityHeaders: RequestHandler = (request, _response, next) => {
  for (const name of IDENTITY_HEADERS) delete request.headers[name];
  next();
};
