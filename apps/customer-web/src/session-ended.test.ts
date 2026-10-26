import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { request, setSessionEndedListener } from "./customer-api.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("a 401 ends the shopper session", () => {
  let ended: Mock;

  beforeEach(() => {
    ended = vi.fn();
    setSessionEndedListener(ended);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ title: "Authentication required", status: 401, code: "unauthenticated" }, 401)),
    );
  });

  afterEach(() => {
    setSessionEndedListener(undefined);
    vi.unstubAllGlobals();
  });

  it("calls the listener for a shopper request that answers 401", async () => {
    await expect(request("/api/cart")).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("does not call the listener for the session routes, which answer 401 by design", async () => {
    await expect(request("/api/auth/me")).rejects.toThrow();
    expect(ended).not.toHaveBeenCalled();
  });
});
