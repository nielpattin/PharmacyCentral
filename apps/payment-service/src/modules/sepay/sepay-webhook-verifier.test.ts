import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SePayWebhookVerifier } from "./sepay-webhook-verifier.ts";

describe("SePay webhook verifier", () => {
  it("verifies the exact raw body and supports sha256 prefix", () => {
    const rawBody = Buffer.from('{"id":1}');
    const signature = createHmac("sha256", "secret").update(rawBody).digest("hex");
    const verifier = new SePayWebhookVerifier("secret");
    expect(verifier.verify(rawBody, `sha256=${signature}`)).toBe(true);
    expect(verifier.verify(Buffer.from('{"id":2}'), signature)).toBe(false);
  });
});
