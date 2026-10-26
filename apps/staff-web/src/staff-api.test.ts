import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { request, setIdentityContextsEnabled, setSessionEndedListener } from "./staff-api.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const unauthenticated = (): Response =>
  json({ title: "Authentication required", status: 401, code: "unauthenticated" }, 401);

describe("a 401 ends the staff session", () => {
  let fetchMock: Mock;
  let ended: Mock;

  beforeEach(() => {
    ended = vi.fn();
    setSessionEndedListener(ended);
    fetchMock = vi.fn(async () => unauthenticated());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    setSessionEndedListener(undefined);
    setIdentityContextsEnabled(false);
    vi.unstubAllGlobals();
  });

  it("ends the session once when a 401 is answered before any identity context exists", async () => {
    await expect(request("/api/inventory/balances")).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("ends the session once, after the identity-context retry also answers 401", async () => {
    setIdentityContextsEnabled(true);
    const context = { contexts: {}, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/auth/context" ? json(context) : unauthenticated(),
    );

    await expect(request("/api/inventory/balances")).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
    const balanceCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/inventory/balances");
    expect(balanceCalls).toHaveLength(2);
  });

  it("does not end the session for the sign-in and session routes, which answer 401 by design", async () => {
    await expect(request("/api/auth/me")).rejects.toThrow();
    await expect(request("/api/auth/login", { method: "POST", body: "{}" })).rejects.toThrow();
    expect(ended).not.toHaveBeenCalled();
  });

  it("does not end the session for a request that succeeds", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await expect(request("/api/inventory/balances")).resolves.toEqual({ ok: true });
    expect(ended).not.toHaveBeenCalled();
  });
});
