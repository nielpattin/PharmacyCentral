// SePay bank-transfer webhooks, signed the way payment-service verifies them (HMAC-SHA256 over `<timestamp>.<body>`).
import http from "k6/http";
import { hmac } from "k6/crypto";

import { sepayWebhookSecret, targetUrl } from "./config.js";

/** Signature headers for `rawBody`, the exact string that will be sent, with the current unix timestamp. */
export function signedWebhook(rawBody) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = hmac("sha256", sepayWebhookSecret(), `${timestamp}.${rawBody}`, "hex");
  return { "x-sepay-timestamp": timestamp, "x-sepay-signature": `sha256=${digest}` };
}

/** Posts a SePay transaction payload through the gateway, named `POST /payments/sepay/webhook` in metrics. */
export function postWebhook(payload) {
  const rawBody = JSON.stringify(payload);
  return http.post(`${targetUrl()}/api/payments/sepay/webhook`, rawBody, {
    headers: { "Content-Type": "application/json", ...signedWebhook(rawBody) },
    tags: { name: "POST /payments/sepay/webhook" },
  });
}
