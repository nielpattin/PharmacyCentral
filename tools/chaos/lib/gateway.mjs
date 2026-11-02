import { createHmac } from "node:crypto";

import { requiredEnv } from "./env.mjs";

export const ACCOUNTS = Object.freeze({
  customer: "khachhang@pharmacycentral.vn",
  admin: "admin@pharmacycentral.vn",
  // Creating a product is the Pharmacy Manager's; Platform Admin is refused (ROLE_RULES.pharmacyManager).
  manager: "manager@pharmacycentral.vn",
});

const REQUEST_TIMEOUT_MS = 20_000;

/** The gateway on localhost, or the public API of a deployed stack when CHAOS_BASE_URL is set. */
export function baseUrl() {
  const remote = process.env.CHAOS_BASE_URL;
  return remote ? remote.replace(/\/+$/, "") : `http://127.0.0.1:${requiredEnv("GATEWAY_PORT")}`;
}

/**
 * A signed-in (or anonymous) client for the gateway on localhost. Every request has a timeout and resolves with
 * `{ status, body }`, status 0 on a network failure, so an outage is data to assert on rather than an exception.
 * A read-only client refuses anything but GET.
 */
export class GatewayClient {
  constructor({ readOnly = false } = {}) {
    this.readOnly = readOnly;
    this.base = baseUrl();
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
  }

  async login(email) {
    const response = await this.request("POST", "/api/auth/login", {
      body: { email, password: requiredEnv(email === ACCOUNTS.admin ? "ADMIN_PASSWORD" : "DEMO_ACCOUNT_PASSWORD") },
    });
    if (response.status !== 200) throw new Error(`Login failed for ${email} with status ${response.status}`);
    this.keepToken(response.body);
    return this;
  }

  keepToken({ accessToken, accessTokenExpiresAt }) {
    this.accessToken = accessToken;
    this.accessTokenExpiresAt = new Date(accessTokenExpiresAt).getTime();
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body, { timeoutMs } = {}) {
    return this.request("POST", path, { body, timeoutMs });
  }

  put(path, body) {
    return this.request("PUT", path, { body });
  }

  patch(path, body) {
    return this.request("PATCH", path, { body });
  }

  /** Sends `rawBody` as is with its own content type (image uploads). */
  postRaw(path, rawBody, contentType, { timeoutMs } = {}) {
    return this.request("POST", path, { rawBody, contentType, timeoutMs });
  }

  async request(method, path, { body, rawBody, contentType, query, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    // Signing in only fetches a token, so a read-only client may still log in.
    if (this.readOnly && method !== "GET" && !path.startsWith("/api/auth/")) {
      throw new Error(`read-only client refused ${method} ${path}`);
    }
    const url = new URL(this.base + path);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const headers = { Accept: "application/json" };
    if (rawBody !== undefined) headers["Content-Type"] = contentType;
    else if (body !== undefined) headers["Content-Type"] = "application/json";
    // Anonymous requests carry no token: only a signed-in client has one to send.
    if (this.accessToken !== undefined) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
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
    const response = await fetch(`${baseUrl()}/api/payments/sepay/webhook`, {
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
