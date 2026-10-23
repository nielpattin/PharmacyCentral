import { createHmac } from "node:crypto";

import { requiredEnv } from "./env.mjs";

export const ACCOUNTS = Object.freeze({
  customer: "khachhang@pharmacycentral.vn",
  admin: "admin@pharmacycentral.vn",
});

// Mirrors deploy/local/gateway/routes.conf (and tools/k6/lib/session.js): which service answers each prefix.
const IDENTITY = "identity-service";
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
const REQUEST_TIMEOUT_MS = 20_000;
const CONTEXT_REFRESH_MS = 3 * 60 * 1000;

function serviceFor(path) {
  const route = ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return route?.[1];
}

/**
 * A signed-in (or anonymous) client for the gateway on localhost. Every request has a timeout and resolves with
 * `{ status, body }`, status 0 on a network failure, so an outage is data to assert on rather than an exception.
 * A read-only client refuses anything but GET.
 */
export class GatewayClient {
  constructor({ readOnly = false } = {}) {
    this.readOnly = readOnly;
    this.base = `http://127.0.0.1:${requiredEnv("GATEWAY_PORT")}`;
    this.cookies = new Map();
    this.contexts = undefined;
    this.contextsAt = 0;
    this.signedIn = false;
  }

  async login(email) {
    await this.request("GET", "/api/auth/csrf");
    const response = await this.request("POST", "/api/auth/login", {
      body: { email, password: requiredEnv("DEMO_ACCOUNT_PASSWORD") },
    });
    if (response.status !== 200) throw new Error(`Login failed for ${email} with status ${response.status}`);
    this.signedIn = true;
    await this.refreshContexts();
    return this;
  }

  async refreshContexts() {
    const response = await this.request("GET", "/api/auth/context");
    if (response.status !== 200 || !response.body?.contexts) {
      throw new Error(`Identity contexts could not be read (status ${response.status})`);
    }
    this.contexts = response.body.contexts;
    this.contextsAt = Date.now();
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body, { timeoutMs } = {}) {
    return this.request("POST", path, { body, csrf: true, timeoutMs });
  }

  put(path, body) {
    return this.request("PUT", path, { body, csrf: true });
  }

  patch(path, body) {
    return this.request("PATCH", path, { body, csrf: true });
  }

  /** Sends `rawBody` as is with its own content type (image uploads). */
  postRaw(path, rawBody, contentType, { timeoutMs } = {}) {
    return this.request("POST", path, { rawBody, contentType, csrf: true, timeoutMs });
  }

  async request(
    method,
    path,
    { body, rawBody, contentType, query, csrf = false, timeoutMs = REQUEST_TIMEOUT_MS } = {},
  ) {
    // Signing in only opens a session, so a read-only client may still log in.
    if (this.readOnly && method !== "GET" && !path.startsWith("/api/auth/")) {
      throw new Error(`read-only client refused ${method} ${path}`);
    }
    const url = new URL(this.base + path);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const headers = { Accept: "application/json" };
    if (rawBody !== undefined) headers["Content-Type"] = contentType;
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    if (csrf) {
      const token = this.cookies.get("pharmacy_csrf");
      if (!token) throw new Error(`No pharmacy_csrf cookie for ${method} ${path}: log in first`);
      headers["X-CSRF-TOKEN"] = token;
    }
    const service = serviceFor(url.pathname);
    // Anonymous requests carry no identity context: only a signed-in client has one to send.
    if (service && service !== IDENTITY && this.signedIn) {
      if (Date.now() - this.contextsAt >= CONTEXT_REFRESH_MS) await this.refreshContexts();
      const context = this.contexts?.[service];
      if (context) headers["x-internal-identity-context"] = context;
    }
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const separator = pair.indexOf("=");
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1);
        if (value === "") this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
      const text = await response.text();
      const isJson = (response.headers.get("content-type") ?? "").includes("json");
      return { status: response.status, body: isJson && text !== "" ? JSON.parse(text) : text };
    } catch (error) {
      return { status: 0, body: undefined, error: error.name };
    }
  }
}

/** Posts a SePay transfer through the gateway, signed as payment-service verifies it. Returns `{ status, body }`. */
export async function postSepayWebhook(payload) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", requiredEnv("SEPAY_WEBHOOK_SECRET"))
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  try {
    const response = await fetch(`http://127.0.0.1:${requiredEnv("GATEWAY_PORT")}/api/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-timestamp": timestamp,
        "x-sepay-signature": `sha256=${digest}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : safeJson(text) };
  } catch (error) {
    return { status: 0, body: undefined, error: error.name };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
