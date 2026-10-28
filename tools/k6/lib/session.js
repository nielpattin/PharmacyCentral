// Logged-in demo sessions for k6. Cookies live in the VU's cookie jar; identity contexts are cached for three minutes
// because the gateway tokens expire after five.
import http from "k6/http";

import { passwordOf, targetUrl } from "./config.js";

const CONTEXT_REFRESH_MS = 3 * 60 * 1000;
const IDENTITY = "identity-service";
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors deploy/local/gateway/routes.conf. Identity issues no context token: its routes authenticate by session cookie.
const ROUTES = [
  ["/api/auth", IDENTITY],
  ["/api/admin", IDENTITY],
  ["/api/customers", IDENTITY],
  ["/api/sites", "catalog-service"],
  ["/api/storage-locations", "catalog-service"],
  ["/api/products", "catalog-service"],
  ["/api/suppliers", "catalog-service"],
  ["/api/pricing", "catalog-service"],
  ["/api/stores", "catalog-service"],
  ["/api/availability", "catalog-service"],
  ["/api/procurement", "inventory-service"],
  ["/api/inventory", "inventory-service"],
  ["/api/quality", "inventory-service"],
  ["/api/carts", "sales-service"],
  ["/api/orders", "sales-service"],
  ["/api/delivery", "sales-service"],
  ["/api/prescriptions", "sales-service"],
  ["/api/counter-transactions", "sales-service"],
  ["/api/payments", "payment-service"],
  ["/api/chatbot", "chatbot-service"],
  ["/api/operations", "operations-query-service"],
  ["/api/dashboard", "operations-query-service"],
  ["/api/finance", "operations-query-service"],
  ["/api/audit", "operations-query-service"],
  ["/api/reports", "operations-query-service"],
];

function serviceFor(path) {
  const route = ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (!route) throw new Error(`No gateway route for ${path}: add it to ROUTES in lib/session.js`);
  return route[1];
}

// Stable metric name: `METHOD /path` without the /api prefix, with every id segment replaced by `:id`.
function defaultName(method, path) {
  const segments = path
    .replace(/^\/api/, "")
    .split("/")
    .map((segment) => (UUID.test(segment) || /^\d+$/.test(segment) ? ":id" : segment));
  return `${method} ${segments.join("/")}`;
}

function withQuery(path, query) {
  const pairs = Object.entries(query ?? {}).filter(([, value]) => value !== undefined && value !== null);
  if (pairs.length === 0) return path;
  return `${path}?${pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}`;
}

// The k6 response, where `json()` returns undefined for a body that is not JSON instead of throwing.
function wrap(response) {
  return {
    status: response.status,
    body: response.body,
    headers: response.headers,
    timings: response.timings,
    url: response.url,
    error: response.error,
    error_code: response.error_code,
    json(selector) {
      try {
        return selector === undefined ? response.json() : response.json(selector);
      } catch (_error) {
        return undefined;
      }
    },
  };
}

function csrfToken() {
  const token = http.cookieJar().cookiesForURL(targetUrl()).pharmacy_csrf?.[0];
  if (!token) throw new Error("No pharmacy_csrf cookie in this VU's jar: call login() before a mutating request");
  return token;
}

function refreshContexts(session) {
  const response = send(session, "GET", "/api/auth/context", null, { name: "GET /auth/context" }, false);
  const contexts = response.json()?.contexts;
  if (response.status !== 200 || !contexts) {
    throw new Error(`Identity contexts for ${session.email} could not be read (status ${response.status})`);
  }
  session.contexts = contexts;
  session.contextsAt = Date.now();
}

function contextFor(session, path) {
  const service = serviceFor(path);
  if (service === IDENTITY) return undefined;
  if (session.contexts === undefined || Date.now() - session.contextsAt >= CONTEXT_REFRESH_MS) {
    refreshContexts(session);
  }
  return session.contexts[service];
}

function requestHeaders(session, path, extra, csrf) {
  const headers = { Accept: "application/json", ...extra };
  const context = contextFor(session, path);
  if (context) headers["x-internal-identity-context"] = context;
  if (csrf) headers["X-CSRF-TOKEN"] = csrfToken();
  return headers;
}

// One gateway request: identity context by path prefix, CSRF on mutating methods, and a stable metric name.
// `params.expect` adds statuses that are business answers rather than failures (e.g. 409 out of stock) on top of 2xx/3xx.
function send(session, method, path, rawBody, params, csrf) {
  const headers = requestHeaders(session, path, params.headers, csrf);
  const requestParams = { headers, tags: { name: params.name ?? defaultName(method, path) } };
  if (params.expect) requestParams.responseCallback = http.expectedStatuses({ min: 200, max: 399 }, ...params.expect);
  return wrap(http.request(method, targetUrl() + withQuery(path, params.query), rawBody, requestParams));
}

function sendJson(session, method, path, body, params) {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  const rawBody = body === undefined ? null : JSON.stringify(body);
  return send(session, method, path, rawBody, { ...params, headers: { ...headers, ...params.headers } }, true);
}

function createSession(email) {
  // Methods take `params`: `query` (object, URL-encoded), `name` (metric name, default `METHOD /path` with ids as `:id`),
  // `expect` (extra statuses to count as answers, e.g. [409]), `headers`. Mutating methods send X-CSRF-TOKEN.
  const session = { email, account: undefined, cookies: {}, contexts: undefined, contextsAt: 0 };
  session.get = (path, params = {}) => send(session, "GET", path, null, params, false);
  session.post = (path, body, params = {}) => sendJson(session, "POST", path, body, params);
  session.put = (path, body, params = {}) => sendJson(session, "PUT", path, body, params);
  session.patch = (path, body, params = {}) => sendJson(session, "PATCH", path, body, params);
  session.del = (path, body, params = {}) => sendJson(session, "DELETE", path, body, params);
  // Sends `rawBody` as is: no JSON encoding and no CSRF token. Set Content-Type in `params.headers`.
  session.postRaw = (path, rawBody, params = {}) => send(session, "POST", path, rawBody, params, false);
  // Headers of a mutating request (identity context, CSRF token) for callers that build their own http.batch.
  session.mutatingHeaders = (path, extra = {}) => requestHeaders(session, path, extra, true);
  return session;
}

/** Logs in an account (CSRF cookie, then login, then identity contexts) and returns its session. */
export function login(email) {
  const password = passwordOf(email);
  const session = createSession(email);
  send(session, "GET", "/api/auth/csrf", null, { name: "GET /auth/csrf" }, false);
  const response = sendJson(session, "POST", "/api/auth/login", { email, password }, { name: "POST /auth/login" });
  if (response.status !== 200) throw new Error(`Login failed for ${email} with status ${response.status}`);
  session.account = response.json();
  session.cookies = http.cookieJar().cookiesForURL(targetUrl());
  refreshContexts(session);
  return session;
}

const sessionsByEmail = new Map();

/** The VU's session for `email`, logged in once per VU. k6 empties the cookie jar per iteration, so cookies are restored. */
export function loginOncePerVu(email) {
  if (!sessionsByEmail.has(email)) sessionsByEmail.set(email, login(email));
  const session = sessionsByEmail.get(email);
  const jar = http.cookieJar();
  for (const [name, values] of Object.entries(session.cookies)) {
    for (const value of values) jar.set(targetUrl(), name, value);
  }
  return session;
}
