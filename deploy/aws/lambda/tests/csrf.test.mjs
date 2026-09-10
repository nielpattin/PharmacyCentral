import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createCsrfCookie,
  createCsrfHandler,
  extractCsrfCookie,
  extractHeader,
  generateCsrfToken,
  validateCsrfToken,
} from "../csrf.mjs";

describe("csrf - tokens, cookies, and validation", () => {
  it("generates 32-byte base64url csrf tokens", () => {
    const token = generateCsrfToken();
    assert.equal(typeof token, "string");
    assert.equal(Buffer.from(token, "base64url").length, 32);
  });

  it("creates csrf cookie header string for dev and prod", () => {
    const token = "sample-csrf-token";
    const devCookie = createCsrfCookie(token, false);
    assert.equal(devCookie, "pharmacy_csrf=sample-csrf-token; SameSite=Lax; Path=/; Max-Age=3600");

    const prodCookie = createCsrfCookie(token, true);
    assert.equal(prodCookie, "pharmacy_csrf=sample-csrf-token; SameSite=Lax; Path=/; Max-Age=3600; Secure");
  });

  it("extracts csrf cookie from single cookie string or array", () => {
    assert.equal(extractCsrfCookie("pharmacy_csrf=abc123"), "abc123");
    assert.equal(extractCsrfCookie("other=foo; pharmacy_csrf=abc123; session=xyz"), "abc123");
    assert.equal(extractCsrfCookie(["other=foo", "pharmacy_csrf=abc123"]), "abc123");
    assert.equal(extractCsrfCookie(""), undefined);
    assert.equal(extractCsrfCookie(undefined), undefined);
  });

  it("extracts headers case-insensitively", () => {
    const headers = {
      "X-CSRF-TOKEN": "token-123",
      Cookie: "pharmacy_csrf=token-123",
    };
    assert.equal(extractHeader(headers, "x-csrf-token"), "token-123");
    assert.equal(extractHeader(headers, "X-Csrf-Token"), "token-123");
    assert.equal(extractHeader(headers, "cookie"), "pharmacy_csrf=token-123");
    assert.equal(extractHeader(headers, "nonexistent"), undefined);
  });

  it("validates matching csrf token and cookie", () => {
    const token = generateCsrfToken();
    const cookie = `pharmacy_csrf=${token}`;
    const headers = { "x-csrf-token": token };

    assert.equal(validateCsrfToken(cookie, headers), true);
  });

  it("rejects mismatched csrf tokens", () => {
    const cookie = "pharmacy_csrf=tokenA";
    const headers = { "x-csrf-token": "tokenB" };

    assert.equal(validateCsrfToken(cookie, headers), false);
  });

  it("rejects when cookie or header is missing", () => {
    assert.equal(validateCsrfToken(undefined, { "x-csrf-token": "token" }), false);
    assert.equal(validateCsrfToken("pharmacy_csrf=token", {}), false);
    assert.equal(validateCsrfToken("other=123", { "x-csrf-token": "token" }), false);
  });

  it("csrf handler returns APIGW 2.0 payload format response", async () => {
    const handler = createCsrfHandler({
      isProduction: false,
      randomBytesFn: () => "mock-csrf-token",
    });

    const response = await handler({});
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json");
    assert.equal(
      response.headers["set-cookie"],
      "pharmacy_csrf=mock-csrf-token; SameSite=Lax; Path=/; Max-Age=3600",
    );
    assert.deepEqual(response.cookies, ["pharmacy_csrf=mock-csrf-token; SameSite=Lax; Path=/; Max-Age=3600"]);
    assert.deepEqual(JSON.parse(response.body), { token: "mock-csrf-token" });
  });
});
