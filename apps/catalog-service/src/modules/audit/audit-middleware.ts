import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuditEntry, AuditRecorder } from "./audit-recorder.ts";

/** Where the verb of an action comes from when the route carries it: a path parameter or a field of the request body. */
type ActionFromRequest = { prefix: string } & ({ param: string } | { body: string });

/**
 * One audited route: a write that, once it succeeds, leaves an entry in the audit log. `route` is the Express route
 * path as the service declares it. `details` names the request body fields worth keeping next to the entry; nothing
 * else of the body is stored, so a free-text note or a secret never reaches the log by accident.
 */
export type AuditRule = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  route: string;
  entityType: string;
  action: string | ActionFromRequest;
  /** The path parameter holding the entity id. Defaults to `id`. When the route has none, the response's `id` is used. */
  idParam?: string;
  details?: readonly string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERB = /^[a-z][a-z0-9-]{0,39}$/;
const SITE_KEYS = ["siteId", "sourceSiteId"] as const;

const uuidOf = (value: unknown): string | undefined =>
  typeof value === "string" && UUID.test(value) ? value : undefined;

const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const actionOf = (rule: AuditRule, request: Request): string | undefined => {
  if (typeof rule.action === "string") return rule.action;
  const raw = "param" in rule.action ? request.params[rule.action.param] : recordOf(request.body)[rule.action.body];
  const verb = typeof raw === "string" ? raw.toLowerCase() : "";
  return VERB.test(verb) ? `${rule.action.prefix}.${verb}` : undefined;
};

/**
 * The audit entry for a request that succeeded, or undefined when no rule names the route or the verb is not a plain
 * word. The entity id comes from the path, else from the created record in the response; the site from the response,
 * else from the request.
 */
export const resolveAuditEntry = (
  rules: readonly AuditRule[],
  request: Request,
  responseBody: unknown,
): AuditEntry | undefined => {
  const route = (request.route as { path?: unknown } | undefined)?.path;
  if (typeof route !== "string") return undefined;
  const rule = rules.find((candidate) => candidate.method === request.method && candidate.route === route);
  if (!rule) return undefined;
  const action = actionOf(rule, request);
  if (!action) return undefined;
  const requestBody = recordOf(request.body);
  const created = recordOf(responseBody);
  const siteId = SITE_KEYS.map((key) => uuidOf(created[key]) ?? uuidOf(requestBody[key])).find(Boolean);
  const details: Record<string, string | number | boolean | null> = {};
  for (const key of rule.details ?? []) {
    const value = requestBody[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      details[key] = value as string | number | boolean | null;
    }
  }
  return {
    action,
    entityType: rule.entityType,
    entityId: uuidOf(request.params[rule.idParam ?? "id"]) ?? uuidOf(created.id),
    siteId,
    actorId: uuidOf(request.header("x-actor-id")),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
};

/**
 * Records every successful write that matches a rule, after the response has been sent, so a slow audit insert never
 * delays the caller. Mount it after the trusted-request middleware, which sets the verified `x-actor-id`. It keeps the
 * JSON body of the response to read the created record's id and site.
 */
export const createAuditMiddleware =
  (rules: readonly AuditRule[], recorder: AuditRecorder): RequestHandler =>
  (request: Request, response: Response, next: NextFunction) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return next();
    // A service calling another is not a person acting: the caller audits its own write, and a retried call would repeat
    // the entry (inventory answers a repeated dispense with the stored result and a 201).
    if (request.header("x-actor-type") === "system") return next();
    let responseBody: unknown;
    const originalJson = response.json.bind(response);
    response.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };
    response.on("finish", () => {
      if (response.statusCode < 200 || response.statusCode >= 300) return;
      const entry = resolveAuditEntry(rules, request, responseBody);
      if (entry) void recorder.record(entry);
    });
    return next();
  };
