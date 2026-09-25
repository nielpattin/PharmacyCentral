import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SePayWebhookVerifier } from "./sepay-webhook-verifier.ts";

const secret = "secret";
const rawBody = Buffer.from('{"id":1}');
const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const sign = (timestamp: number, body: Buffer | string = rawBody): string =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;

describe("SePay webhook verifier", () => {
  const verifier = new SePayWebhookVerifier(secret);

  it("accepts the timestamp-prefixed signature SePay sends", () => {
    const timestamp = nowSeconds();
    expect(verifier.verify(rawBody, sign(timestamp), String(timestamp))).toBe(true);
    expect(verifier.verify(rawBody, sign(timestamp).replace("sha256=", ""), String(timestamp))).toBe(true);
  });

  it("rejects a signature computed over the body alone", () => {
    const timestamp = nowSeconds();
    const bodyOnly = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    expect(verifier.verify(rawBody, bodyOnly, String(timestamp))).toBe(false);
  });

  it("rejects a body that does not match the signature", () => {
    const timestamp = nowSeconds();
    expect(verifier.verify(Buffer.from('{"id":2}'), sign(timestamp), String(timestamp))).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    const timestamp = nowSeconds();
    const foreign = `sha256=${createHmac("sha256", "other").update(`${timestamp}.`).update(rawBody).digest("hex")}`;
    expect(verifier.verify(rawBody, foreign, String(timestamp))).toBe(false);
  });

  it("rejects timestamps outside the replay window", () => {
    const stale = nowSeconds() - 301;
    const ahead = nowSeconds() + 301;
    expect(verifier.verify(rawBody, sign(stale), String(stale))).toBe(false);
    expect(verifier.verify(rawBody, sign(ahead), String(ahead))).toBe(false);
    const edge = nowSeconds() - 299;
    expect(verifier.verify(rawBody, sign(edge), String(edge))).toBe(true);
  });

  it("rejects requests without a timestamp, signature, or secret", () => {
    const timestamp = nowSeconds();
    expect(verifier.verify(rawBody, sign(timestamp), undefined)).toBe(false);
    expect(verifier.verify(rawBody, undefined, String(timestamp))).toBe(false);
    expect(verifier.verify(rawBody, sign(timestamp), "not-a-timestamp")).toBe(false);
    expect(new SePayWebhookVerifier("").verify(rawBody, sign(timestamp), String(timestamp))).toBe(false);
  });
});
