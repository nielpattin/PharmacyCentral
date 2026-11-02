// Logged-in demo sessions for k6. Login returns an access token that every request sends as a bearer.
import http from "k6/http";

import { passwordOf, targetUrl } from "./config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function keepToken(session, body) {
  session.accessToken = body.accessToken;
  session.accessTokenExpiresAt = new Date(body.accessTokenExpiresAt).getTime();
}

function requestHeaders(session, extra) {
  const headers = { Accept: "application/json", ...extra };
  if (session.accessToken !== undefined) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

// One gateway request with the bearer token and a stable metric name.
// `params.expect` adds statuses that are business answers rather than failures (e.g. 409 out of stock) on top of 2xx/3xx.
function send(session, method, path, rawBody, params) {
  const headers = requestHeaders(session, params.headers);
  const requestParams = { headers, tags: { name: params.name ?? defaultName(method, path) } };
  if (params.expect) requestParams.responseCallback = http.expectedStatuses({ min: 200, max: 399 }, ...params.expect);
  return wrap(http.request(method, targetUrl() + withQuery(path, params.query), rawBody, requestParams));
}

function sendJson(session, method, path, body, params) {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  const rawBody = body === undefined ? null : JSON.stringify(body);
  return send(session, method, path, rawBody, { ...params, headers: { ...headers, ...params.headers } });
}

function createSession(email) {
  // Methods take `params`: `query` (object, URL-encoded), `name` (metric name, default `METHOD /path` with ids as `:id`),
  // `expect` (extra statuses to count as answers, e.g. [409]), `headers`.
  const session = { email, account: undefined, accessToken: undefined, accessTokenExpiresAt: 0 };
  session.get = (path, params = {}) => send(session, "GET", path, null, params);
  session.post = (path, body, params = {}) => sendJson(session, "POST", path, body, params);
  session.put = (path, body, params = {}) => sendJson(session, "PUT", path, body, params);
  session.patch = (path, body, params = {}) => sendJson(session, "PATCH", path, body, params);
  session.del = (path, body, params = {}) => sendJson(session, "DELETE", path, body, params);
  // Sends `rawBody` as is, with no JSON encoding. Set Content-Type in `params.headers`.
  session.postRaw = (path, rawBody, params = {}) => send(session, "POST", path, rawBody, params);
  // Request headers (bearer token, then `extra`) for callers that build their own http.batch.
  session.authHeaders = (path, extra = {}) => requestHeaders(session, extra);
  return session;
}

/** Logs in an account and returns its session with its access token. */
export function login(email) {
  const password = passwordOf(email);
  const session = createSession(email);
  const response = sendJson(session, "POST", "/api/auth/login", { email, password }, { name: "POST /auth/login" });
  if (response.status !== 200) throw new Error(`Login failed for ${email} with status ${response.status}`);
  session.account = response.json();
  keepToken(session, session.account);
  return session;
}

const sessionsByEmail = new Map();

/** The VU's session for `email`, logged in once per VU. */
export function loginOncePerVu(email) {
  if (!sessionsByEmail.has(email)) sessionsByEmail.set(email, login(email));
  return sessionsByEmail.get(email);
}
