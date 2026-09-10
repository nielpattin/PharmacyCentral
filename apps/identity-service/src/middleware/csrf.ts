import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { matchesPathPrefix } from "./trusted-request.ts";

export const CSRF_COOKIE_NAME = "pharmacy_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXEMPT_PREFIXES: readonly string[] = [
  "/auth/login",
  "/auth/register",
  "/auth/setup-admin",
  "/auth/setup-status",
  "/auth/verify-email",
  "/auth/google/",
  "/auth/request-password-reset",
  "/auth/reset-password",
  "/auth/csrf",
  "/auth/context",
];

const readCookie = (request: Request, name: string): string | undefined => {
  const match = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
};

export const createCsrfMiddleware = (): RequestHandler => {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(request.method)) {
      next();
      return;
    }
    if (EXEMPT_PREFIXES.some((prefix) => matchesPathPrefix(request.path, prefix))) {
      next();
      return;
    }
    const header = request.header(CSRF_HEADER_NAME);
    const cookie = readCookie(request, CSRF_COOKIE_NAME);
    const valid =
      Boolean(header) &&
      Boolean(cookie) &&
      header?.length === cookie?.length &&
      timingSafeEqual(Buffer.from(header ?? "", "utf8"), Buffer.from(cookie ?? "", "utf8"));
    if (!valid) {
      response.status(403).json({ title: "CSRF token mismatch", status: 403, code: "csrf_mismatch" });
      return;
    }
    next();
  };
};
