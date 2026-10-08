import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";

import type { Logger } from "../../logger.ts";

/**
 * The mistakes body-parser blames on the client, keyed by the `type` it sets on its errors. An error that is not in
 * this table, or carries no `type` at all, is a fault of this service and must not be reported as the client's.
 */
const BODY_PARSER_CLIENT_ERRORS: Record<string, { status: number; title: string }> = {
  "entity.too.large": { status: 413, title: "Payload too large" },
  "encoding.unsupported": { status: 415, title: "Unsupported content encoding" },
  "entity.parse.failed": { status: 400, title: "Malformed request body" },
};

/** The body-parser error a client caused, if any; anything else is a server-side fault. */
const clientError = (error: unknown): { type: string; status: number; title: string } | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const { type } = error as { type?: unknown };
  if (typeof type !== "string") return undefined;
  const known = BODY_PARSER_CLIENT_ERRORS[type];
  return known ? { type, ...known } : undefined;
};

/**
 * The last middleware of the app: an error nobody handled becomes a JSON problem.
 *
 * A client error answers with its own status and is logged at warn without the body, because the body is exactly
 * what the client got wrong: an upload over the route limit or unparseable JSON, the whole of which would turn the
 * error log into a copy of the request. Everything else is a fault of this service and stays at error level.
 */
export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (error: unknown, _request: Request, response: Response, _next: NextFunction): void => {
    const rejected = clientError(error);
    if (rejected) {
      logger.warn({ type: rejected.type, status: rejected.status }, "rejected client request");
      response.status(rejected.status).json({ title: rejected.title, status: rejected.status });
      return;
    }
    logger.error({ error }, "unhandled request error");
    response.status(500).json({ title: "Internal Server Error", status: 500 });
  };
