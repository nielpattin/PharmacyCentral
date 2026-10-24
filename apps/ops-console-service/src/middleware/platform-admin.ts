import { createHmac, timingSafeEqual } from "node:crypto";
import { trace } from "@opentelemetry/api";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import {
  internalIdentityContextSchema,
  signedInternalIdentityContextSchema,
  type InternalIdentityContext,
} from "../contracts/common.ts";

export const verifyIdentityContext = (
  header: string | undefined,
  secret: string,
  audience: string,
  now = new Date(),
): InternalIdentityContext | undefined => {
  if (!header) return undefined;
  try {
    const signed = signedInternalIdentityContextSchema.parse(
      JSON.parse(Buffer.from(header, "base64url").toString("utf8")),
    );
    const expected = Buffer.from(
      createHmac("sha256", secret).update(JSON.stringify(signed.context)).digest("hex"),
      "utf8",
    );
    const provided = Buffer.from(signed.signature, "utf8");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;
    const context = internalIdentityContextSchema.parse(signed.context);
    if (new Date(context.expiresAt).getTime() <= now.getTime()) return undefined;
    if (new Date(context.issuedAt).getTime() > now.getTime()) return undefined;
    return context.audience === audience ? context : undefined;
  } catch {
    return undefined;
  }
};

const HEALTH_PREFIX = "/health";

/** Everything except the health probes is for a signed-in employee with the Platform Admin role, and nobody else. */
export const requirePlatformAdmin =
  (options: { identitySecret: string; audience: string }): RequestHandler =>
  (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === HEALTH_PREFIX || request.path.startsWith(`${HEALTH_PREFIX}/`)) {
      next();
      return;
    }
    const context = verifyIdentityContext(
      request.header("x-internal-identity-context"),
      options.identitySecret,
      options.audience,
    );
    if (!context) {
      response
        .status(401)
        .json({ title: "Trusted gateway request required", status: 401, code: "trusted_request_required" });
      return;
    }
    const span = trace.getActiveSpan();
    span?.setAttribute("correlation_id", context.correlationId);
    span?.setAttribute("request_id", context.requestId);
    if (context.actorType !== "employee" || !context.roles.includes("Platform Admin")) {
      response
        .status(403)
        .json({ title: "Platform Admin access required", status: 403, code: "platform_admin_required" });
      return;
    }
    next();
  };
