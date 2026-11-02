import { trace } from "@opentelemetry/api";
import { bearerToken, type AccessTokenVerifier } from "@pharmacy/auth";
import type { NextFunction, Request, RequestHandler, Response } from "express";

const HEALTH_PREFIX = "/health";

/** Everything except the health probes is for a signed-in employee with the Platform Admin role, and nobody else. */
export const requirePlatformAdmin =
  (options: { verifier: AccessTokenVerifier }): RequestHandler =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (request.path === HEALTH_PREFIX || request.path.startsWith(`${HEALTH_PREFIX}/`)) {
      next();
      return;
    }
    const identity = await options.verifier.verify(bearerToken(request.header("authorization")));
    if (!identity) {
      response
        .status(401)
        .json({ title: "Trusted gateway request required", status: 401, code: "trusted_request_required" });
      return;
    }
    const requestId = request.header("x-request-id");
    if (requestId) trace.getActiveSpan()?.setAttribute("request_id", requestId);
    if (identity.passwordChangeRequired) {
      response.status(403).json({ title: "Password change required", status: 403, code: "password_change_required" });
      return;
    }
    if (identity.actorType !== "employee" || !identity.roles.includes("Platform Admin")) {
      response
        .status(403)
        .json({ title: "Platform Admin access required", status: 403, code: "platform_admin_required" });
      return;
    }
    next();
  };
