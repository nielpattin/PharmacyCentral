import { ACCESS_TOKEN_STORAGE_KEY } from "@pharmacy/ui";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { accessTokens, request, setSessionEndedListener } from "./staff-api.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const unauthenticated = (): Response =>
  json({ title: "Authentication required", status: 401, code: "unauthenticated" }, 401);

describe("a 401 ends the staff session", () => {
  let fetchMock: Mock;
  let ended: Mock;
  let items: Map<string, string>;

  beforeEach(() => {
    items = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string): string | null => items.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        items.set(key, value);
      },
      removeItem: (key: string): void => {
        items.delete(key);
      },
    });
    ended = vi.fn();
    setSessionEndedListener(ended);
    fetchMock = vi.fn(async () => unauthenticated());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    setSessionEndedListener(undefined);
    vi.unstubAllGlobals();
  });

  it("ends the session once when a 401 is answered with no token held", async () => {
    await expect(request("/api/inventory/balances")).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("clears the token and ends the session once, without a second attempt", async () => {
    accessTokens.set({ accessToken: "rejected", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await expect(request("/api/inventory/balances")).rejects.toThrow();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(items.has(ACCESS_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it("sends the stored token as a bearer token with no CSRF header", async () => {
    accessTokens.set({ accessToken: "held", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    fetchMock.mockImplementation(async () => json({ ok: true }));

    await expect(request("/api/inventory/balances", { method: "POST", body: "{}" })).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("/api/inventory/balances");
    expect(headers.get("Authorization")).toBe("Bearer held");
    expect(headers.has("X-CSRF-TOKEN")).toBe(false);
    expect(init.credentials).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it("sends no Authorization header once the stored token has expired", async () => {
    accessTokens.set({ accessToken: "stale", accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString() });
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await request("/api/inventory/balances");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("does not end the session for the sign-in and session routes, which answer 401 by design", async () => {
    accessTokens.set({ accessToken: "held", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    await expect(request("/api/auth/me")).rejects.toThrow();
    await expect(request("/api/auth/login", { method: "POST", body: "{}" })).rejects.toThrow();
    expect(ended).not.toHaveBeenCalled();
    expect(accessTokens.current()).toBe("held");
  });

  it("does not end the session for a request that succeeds", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await expect(request("/api/inventory/balances")).resolves.toEqual({ ok: true });
    expect(ended).not.toHaveBeenCalled();
  });
});
